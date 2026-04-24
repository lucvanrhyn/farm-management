/**
 * @vitest-environment node
 *
 * __tests__/alerts/inngest-steps.test.ts — Phase L durable-step split.
 *
 * The `evaluateTenantAlerts` Inngest function used to run evaluate → persist →
 * dispatch inside a single `step.run`. A transient SMTP / push outage in
 * dispatch therefore re-ran the expensive evaluation queries against Tokyo
 * on every retry. Splitting into three labelled steps — `evaluate`, `persist`,
 * `dispatch` — means Inngest checkpoints the evaluation and persistence
 * output; only the failing step re-runs.
 *
 * These tests pin the contract:
 *   1. The handler declares exactly three `step.run` labels in order.
 *   2. `serializeCandidates` / `deserializeCandidates` round-trip every field
 *      of a realistic AlertCandidate (esp. Date ↔ ISO string).
 */

import { describe, it, expect, vi } from "vitest";

import { evaluateTenantAlerts } from "@/lib/server/inngest/functions";
import {
  serializeCandidates,
  deserializeCandidates,
} from "@/lib/server/inngest/serializers";
import type { AlertCandidate } from "@/lib/server/alerts";

// The Inngest SDK stores the handler as `.fn` on the InngestFunction instance
// (see node_modules/inngest/components/InngestFunction.js). We invoke the
// handler directly with a stubbed `step` to observe which labels it uses,
// without needing a running Inngest dev server.
function getHandler(fn: unknown): (ctx: { event: unknown; step: unknown }) => Promise<unknown> {
  const wrapper = fn as { fn?: (ctx: { event: unknown; step: unknown }) => Promise<unknown> };
  if (typeof wrapper.fn !== "function") {
    throw new Error("Inngest function shape changed: `.fn` handler not found");
  }
  return wrapper.fn;
}

describe("evaluateTenantAlerts durable-step split", () => {
  it("declares exactly three step.run labels: evaluate, persist, dispatch", async () => {
    const labels: string[] = [];
    // step.run(label, handler) — record the label, then run the handler with
    // dummy return values wired up so each stage can pass data to the next.
    const run = vi.fn(async (label: string, handler: () => Promise<unknown>) => {
      labels.push(label);
      // Stage-specific fake return values. The handler then feeds each return
      // into the next step; if the code uses different shapes we want the
      // test to blow up loudly, not to silently pass.
      if (label === "evaluate") {
        // serialized candidates (JSON-safe)
        return [] as unknown;
      }
      if (label === "persist") {
        // serialized persisted notifications
        return [] as unknown;
      }
      if (label === "dispatch") {
        return { pushed: 0, suppressedByQuietHours: 0, digestSent: false };
      }
      // Unknown label — still run the handler so we catch any extra steps.
      return handler();
    });
    const sendEvent = vi.fn();

    const handler = getHandler(evaluateTenantAlerts);
    await handler({
      event: { data: { slug: "unit-test-tenant" } },
      step: { run, sendEvent },
    });

    expect(labels).toEqual(["evaluate", "persist", "dispatch"]);
  });
});

describe("AlertCandidate serializer round-trip", () => {
  const expiresAt = new Date("2026-04-25T12:00:00.000Z");

  const realistic: AlertCandidate = {
    type: "LAMBING_DUE_7D",
    category: "reproduction",
    severity: "amber",
    dedupKey: "LAMBING_DUE_7D:ewe-42:2026-W17",
    collapseKey: "camp-7",
    payload: {
      animalId: "ewe-42",
      animalIds: ["ewe-42", "ewe-43"],
      count: 2,
      dueDate: "2026-04-30",
      nested: { foo: "bar", arr: [1, 2, 3] },
    },
    message: "2 ewes lambing within 7 days",
    href: "/admin/reproduction",
    expiresAt,
  };

  it("deserialize(serialize(c)) deep-equals c for a realistic candidate", () => {
    const roundTripped = deserializeCandidates(serializeCandidates([realistic]));
    expect(roundTripped).toHaveLength(1);
    expect(roundTripped[0]).toEqual(realistic);
    // Explicit Date preservation — equality would also accept ISO strings
    // under `toEqual`, so assert the class separately.
    expect(roundTripped[0].expiresAt).toBeInstanceOf(Date);
    expect(roundTripped[0].expiresAt.toISOString()).toBe(expiresAt.toISOString());
  });

  it("produces JSON-safe output (structuredClone/JSON.stringify both succeed)", () => {
    const serialized = serializeCandidates([realistic]);
    // If Prisma class instances or Dates leaked through, JSON.stringify would
    // still succeed but JSON.parse(JSON.stringify(x)) would lose the Date
    // class. We assert the serialized shape uses strings for dates.
    const json = JSON.parse(JSON.stringify(serialized)) as Array<
      Record<string, unknown>
    >;
    expect(json[0].expiresAt).toBe(expiresAt.toISOString());
    expect(typeof json[0].expiresAt).toBe("string");
  });

  it("handles an empty list", () => {
    expect(deserializeCandidates(serializeCandidates([]))).toEqual([]);
  });
});
