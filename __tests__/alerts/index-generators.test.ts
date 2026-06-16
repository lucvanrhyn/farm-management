/**
 * @vitest-environment node
 *
 * __tests__/alerts/index-generators.test.ts — registration contract for the
 * Proactive Nudges v1 generators.
 *
 * The two new generators (needs-inspection, rotation-move-due) must JOIN the
 * existing evaluateAllAlerts fan-out (ADR-0011: no third generator family) with
 * the same Promise.allSettled resilience — one throwing generator must NOT
 * poison the run.
 */

import { describe, it, expect, vi } from "vitest";

// Shared mock state MUST be hoisted — bare top-level consts land in the TDZ
// because vi.mock factories are hoisted above them (feedback-vi-hoisted-shared-mocks).
const { needsInspection, rotationMoveDue } = vi.hoisted(() => ({
  needsInspection: vi.fn().mockResolvedValue([
    {
      type: "NEEDS_INSPECTION_DUE",
      category: "performance",
      severity: "amber",
      dedupKey: "NEEDS_INSPECTION_DUE:c1:2026-W25",
      collapseKey: "tenant",
      payload: { campId: "c1" },
      message: "x",
      href: "/trio/admin/observations",
      expiresAt: new Date(Date.now() + 1000),
    },
  ]),
  rotationMoveDue: vi.fn().mockResolvedValue([
    {
      type: "ROTATION_MOVE_DUE",
      category: "veld",
      severity: "red",
      dedupKey: "ROTATION_MOVE_DUE:c1:2026-W25",
      collapseKey: "tenant",
      payload: { sourceCampId: "c1", targetCampId: "c2" },
      message: "y",
      href: "/trio/admin/camps?tab=rotation",
      expiresAt: new Date(Date.now() + 1000),
    },
  ]),
}));

// Stub every OTHER generator so this test isolates the two new ones. Each
// existing generator exports `evaluate`; we mock the modules index.ts imports.
vi.mock("@/lib/server/alerts/needs-inspection", () => ({ evaluate: needsInspection }));
vi.mock("@/lib/server/alerts/rotation-move-due", () => ({ evaluate: rotationMoveDue }));
vi.mock("@/lib/server/alerts/lambing-due", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/fawning-due", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/shearing-crutching", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/predator-spike", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/rainfall-stale", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/cover-stale", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/weighing-stale", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/cog-breakeven", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/water-service", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/tax-deadline", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/spi-drought", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/alerts/lsu-overstock", () => ({ evaluate: vi.fn().mockResolvedValue([]) }));
// legacy-dashboard throws — proves Promise.allSettled isolation holds.
vi.mock("@/lib/server/alerts/legacy-dashboard", () => ({
  evaluate: vi.fn().mockRejectedValue(new Error("boom")),
}));

import { evaluateAllAlerts } from "@/lib/server/alerts";
import { makePrisma, makeSettings } from "./fixtures";

describe("evaluateAllAlerts — new nudge generators", () => {
  it("includes NEEDS_INSPECTION_DUE and ROTATION_MOVE_DUE candidates", async () => {
    const out = await evaluateAllAlerts(makePrisma({}), makeSettings({}), "trio");
    const types = new Set(out.map((c) => c.type));
    expect(types.has("NEEDS_INSPECTION_DUE")).toBe(true);
    expect(types.has("ROTATION_MOVE_DUE")).toBe(true);
    expect(needsInspection).toHaveBeenCalledOnce();
    expect(rotationMoveDue).toHaveBeenCalledOnce();
  });

  it("a throwing sibling does not drop the new generators' candidates", async () => {
    const out = await evaluateAllAlerts(makePrisma({}), makeSettings({}), "trio");
    // legacy-dashboard rejected; the two new ones still landed.
    expect(out.map((c) => c.type).sort()).toEqual([
      "NEEDS_INSPECTION_DUE",
      "ROTATION_MOVE_DUE",
    ]);
  });
});
