/**
 * @vitest-environment node
 *
 * __tests__/alerts/dedup.test.ts — persistNotifications + collapseCandidates.
 *
 * Three guarantees:
 *  1. Same (type, dedupKey) twice → one row, merged payload.
 *  2. Count ≥ threshold with same (type, collapseKey) → folded into one
 *     "collapsed" candidate before DB write.
 *  3. An existing row that's already isRead=true gets a fresh row, not an
 *     upsert (so users see the alert re-fire next cycle).
 */

import { describe, it, expect, vi } from "vitest";
import { persistNotifications, collapseCandidates } from "@/lib/server/alerts";
import type { AlertCandidate } from "@/lib/server/alerts";
import { makePrisma } from "./fixtures";

function mkCandidate(over: Partial<AlertCandidate>): AlertCandidate {
  return {
    type: "NO_WEIGHING_90D",
    category: "performance",
    severity: "amber",
    dedupKey: "NO_WEIGHING_90D:a-1:2026-W16",
    collapseKey: "camp-1",
    payload: { animalId: "A-1" },
    message: "A-1 not weighed in 95 days",
    href: "/admin/animals",
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    ...over,
  };
}

describe("persistNotifications", () => {
  it("merges payload when an unread row with the same dedupKey exists", async () => {
    const existingRow = {
      id: "exist-1",
      type: "NO_WEIGHING_90D",
      dedupKey: "NO_WEIGHING_90D:a-1:2026-W16",
      severity: "amber",
      message: "A-1 not weighed",
      href: "/admin/animals",
      isRead: false,
      payload: JSON.stringify({ animalIds: ["A-1"], count: 1 }),
    };
    const update = vi.fn().mockImplementation(({ data, where }) =>
      Promise.resolve({ ...existingRow, ...data, id: where.id }),
    );
    const prisma = makePrisma({
      notification: {
        findFirst: vi.fn().mockResolvedValue(existingRow),
        update,
        create: vi.fn(),
      },
    });
    const next = mkCandidate({
      payload: { animalId: "A-2", animalIds: ["A-2"], count: 1 },
    });
    const out = await persistNotifications(prisma, [next]);
    expect(out).toHaveLength(1);
    const updateCall = update.mock.calls[0]?.[0];
    const persistedPayload = JSON.parse(updateCall.data.payload);
    expect(new Set(persistedPayload.animalIds)).toEqual(new Set(["A-1", "A-2"]));
  });

  it("creates a fresh row when the existing match is isRead=true", async () => {
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, id: "new-1" }));
    const prisma = makePrisma({
      notification: {
        findFirst: vi.fn().mockResolvedValue({
          id: "old-1",
          type: "NO_WEIGHING_90D",
          dedupKey: "NO_WEIGHING_90D:a-1:2026-W16",
          isRead: true,
          payload: "{}",
        }),
        create,
        update: vi.fn(),
      },
    });
    await persistNotifications(prisma, [mkCandidate({})]);
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0];
    // dedupKey should be suffixed with timestamp to dodge the unique constraint
    expect(String(arg.data.dedupKey).startsWith("NO_WEIGHING_90D:a-1:2026-W16:")).toBe(true);
  });

  it("is idempotent: calling twice with the same candidate yields one create and one merge update", async () => {
    // Stateful in-memory fixture: first call sees empty table → create;
    // second call sees the row written by the first → merge via update.
    const rows: Array<{
      id: string;
      type: string;
      dedupKey: string | null;
      isRead: boolean;
      payload: string | null;
    }> = [];

    const findFirst = vi.fn().mockImplementation(({ where }: { where: { type: string; dedupKey?: string | null } }) => {
      const hit = rows.find((r) => r.type === where.type && r.dedupKey === where.dedupKey);
      return Promise.resolve(hit ?? null);
    });
    const create = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `n-${rows.length + 1}`,
        type: data.type as string,
        dedupKey: (data.dedupKey as string | null) ?? null,
        isRead: false,
        payload: (data.payload as string | null) ?? null,
        ...data,
      };
      rows.push(row);
      return Promise.resolve(row);
    });
    const update = vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx === -1) throw new Error(`row ${where.id} not found`);
      rows[idx] = { ...rows[idx], ...data };
      return Promise.resolve(rows[idx]);
    });

    const prisma = makePrisma({
      notification: { findFirst, create, update },
    });

    const candidate = mkCandidate({
      dedupKey: "NO_WEIGHING_90D:camp-7:2026-W16",
      payload: { animalIds: ["a1"], count: 1 },
    });

    await persistNotifications(prisma, [candidate]);
    await persistNotifications(prisma, [candidate]);

    // One create (first call), one update (second call merges into existing).
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    // Exactly one row in the "table".
    expect(rows).toHaveLength(1);
  });
});

describe("collapseCandidates", () => {
  it("folds ≥3 weighing alerts in the same camp into one aggregated candidate", () => {
    const group = [1, 2, 3].map((i) =>
      mkCandidate({
        dedupKey: `NO_WEIGHING_90D:a-${i}:2026-W16`,
        payload: { animalId: `A-${i}` },
      }),
    );
    const out = collapseCandidates(group);
    expect(out).toHaveLength(1);
    expect(out[0].payload.collapsed).toBe(true);
    expect(out[0].payload.count).toBe(3);
    const ids = out[0].payload.animalIds as string[];
    expect(ids.sort()).toEqual(["A-1", "A-2", "A-3"]);
  });

  it("leaves a group of 2 weighing alerts unchanged (below threshold 3)", () => {
    const group = [1, 2].map((i) =>
      mkCandidate({
        dedupKey: `NO_WEIGHING_90D:a-${i}:2026-W16`,
        payload: { animalId: `A-${i}` },
      }),
    );
    const out = collapseCandidates(group);
    expect(out).toHaveLength(2);
  });
});
