/**
 * @vitest-environment node
 *
 * Wave A2 — per-species + Active filter (single source of truth).
 *
 * Bug context: the audit on 2026-05-10 (audit-2026-05-10-codex.md) found the
 * camp-detail panel calling `/api/animals?camp=X&status=all` (no species
 * filter, status=all explicitly DISABLES the API's default `Active` gate)
 * and the admin animals page issuing `findMany({ where: { species: mode } })`
 * with no `status` filter at all. Two surfaces, two ways of being wrong, one
 * underlying contract: per-species views must show `mode + Active`.
 *
 * This test pins the contract returned by the shared helper. Both surfaces
 * import the helper, so when this test passes both surfaces are correct by
 * construction. A future surface (mob picker, vision logger) gets the same
 * defence by construction the moment it adopts the helper.
 */
import { describe, it, expect } from "vitest";
import {
  ACTIVE_STATUS,
  activeSpeciesWhere,
  activeSpeciesQueryString,
} from "@/lib/animals/active-species-filter";

describe("active-species-filter — single source of truth for per-species views", () => {
  it("ACTIVE_STATUS matches the column value persisted by the migration", () => {
    // Migration 0007 / 0014 store status as the literal string "Active".
    // If this ever changes, both surfaces drift together via this constant.
    expect(ACTIVE_STATUS).toBe("Active");
  });

  it("activeSpeciesWhere returns the Prisma where shape both per-species surfaces need", () => {
    expect(activeSpeciesWhere("cattle")).toEqual({ species: "cattle", status: "Active" });
    expect(activeSpeciesWhere("sheep")).toEqual({ species: "sheep", status: "Active" });
    expect(activeSpeciesWhere("game")).toEqual({ species: "game", status: "Active" });
  });

  it("activeSpeciesQueryString returns a URL fragment with species AND explicit status=Active", () => {
    // We pass status explicitly (rather than relying on the API default) so
    // the URL is self-documenting AND a future API-default change can't
    // silently flip the camp panel's semantics.
    expect(activeSpeciesQueryString("cattle")).toBe("species=cattle&status=Active");
    expect(activeSpeciesQueryString("sheep")).toBe("species=sheep&status=Active");
    expect(activeSpeciesQueryString("game")).toBe("species=game&status=Active");
  });

  it("activeSpeciesQueryString does NOT contain status=all (the original bug)", () => {
    // Regression guard: the camp-detail panel previously hard-coded
    // `status=all`, which DISABLES the API's Active filter. The helper must
    // never emit that string.
    for (const mode of ["cattle", "sheep", "game"] as const) {
      expect(activeSpeciesQueryString(mode)).not.toContain("status=all");
    }
  });
});
