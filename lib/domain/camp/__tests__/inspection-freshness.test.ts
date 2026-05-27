/**
 * @vitest-environment node
 *
 * Issue #437 — `getLastInspectionAt(prisma, campId, species)`.
 *
 * Single-purpose deep module that returns the ISO timestamp of the latest
 * camp-inspection observation (`camp_check` or `camp_condition`) recorded
 * against `campId` whose `species` column matches `species`. Returns `null`
 * when no species-matching inspection exists.
 *
 * Why this exists
 * ──────────────
 *   The Trio "0 animals · Just now" bug class: on Trio (cattle data only),
 *   flipping the FarmMode toggle to Sheep painted 19 misleading Logger tiles
 *   showing the cattle camp's last inspection timestamp ("Just now") even
 *   though no sheep inspection ever happened. Root cause: `/api/camps/status`
 *   returned the latest inspection observation per camp WITHOUT scoping by
 *   species, so the cattle inspection bled into the sheep view.
 *
 *   This module is the species-aware probe that the `/api/camps?species=…`
 *   route uses to fill `last_inspected_at` per camp. ADR-0005 requires the
 *   read to flow through the `scoped(prisma, species)` door so the species
 *   predicate is structurally enforced (forgetting it is a compile error).
 *
 * Contract
 * ────────
 *   - HIT  — there exists an observation row with `campId === campId`,
 *            `type ∈ {camp_check, camp_condition}` and `species === species`.
 *            Returns the latest such row's `observedAt` as an ISO string.
 *   - MISS — no observation row matches the species predicate (even if the
 *            camp has cattle-side inspection rows). Returns `null`.
 *   - The probe is read-only and uses `scoped()`'s `findFirst` with the
 *     `type: { in: CAMP_INSPECTION_OBSERVATION_TYPES }` filter — i.e. it
 *     reuses the producer/consumer constant from #407 so the inspection
 *     type set never drifts between writer (Logger submit) and reader
 *     (this probe).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  getLastInspectionAt,
  shouldRenderSheepEmptyState,
} from "../inspection-freshness";
import { CAMP_INSPECTION_OBSERVATION_TYPES } from "@/lib/observations/camp-inspection-types";

describe("getLastInspectionAt(prisma, campId, species)", () => {
  const observationFindFirst = vi.fn();
  const prisma = {
    observation: { findFirst: observationFindFirst },
  } as unknown as PrismaClient;

  beforeEach(() => {
    observationFindFirst.mockReset();
  });

  it("returns the ISO observedAt when a species-matching inspection exists (HIT)", async () => {
    observationFindFirst.mockResolvedValue({
      observedAt: new Date("2026-05-26T10:15:00.000Z"),
    });

    const result = await getLastInspectionAt(prisma, "NORTH-01", "sheep");

    expect(result).toBe("2026-05-26T10:15:00.000Z");
  });

  it("scopes the query by species via the scoped() door (species predicate present)", async () => {
    observationFindFirst.mockResolvedValue({
      observedAt: new Date("2026-05-26T10:15:00.000Z"),
    });

    await getLastInspectionAt(prisma, "NORTH-01", "sheep");

    expect(observationFindFirst).toHaveBeenCalledTimes(1);
    const callArgs = observationFindFirst.mock.calls[0][0] as {
      where: { campId: string; type: { in: readonly string[] }; species: string };
      orderBy: { observedAt: "desc" };
    };
    // scoped(prisma, 'sheep') injects `species: 'sheep'` into every `where`.
    expect(callArgs.where.species).toBe("sheep");
    expect(callArgs.where.campId).toBe("NORTH-01");
    expect([...callArgs.where.type.in].sort()).toEqual(
      [...CAMP_INSPECTION_OBSERVATION_TYPES].sort(),
    );
    expect(callArgs.orderBy).toEqual({ observedAt: "desc" });
  });

  it("returns null when no species-matching inspection exists (MISS)", async () => {
    observationFindFirst.mockResolvedValue(null);

    const result = await getLastInspectionAt(prisma, "NORTH-01", "sheep");

    expect(result).toBeNull();
  });

  it("returns null for a camp that has no inspections at all (no-camp MISS)", async () => {
    observationFindFirst.mockResolvedValue(null);

    const result = await getLastInspectionAt(prisma, "DOES-NOT-EXIST", "cattle");

    expect(result).toBeNull();
  });

  it("treats a string observedAt as already-ISO and returns it verbatim", async () => {
    // Some Prisma adapters surface dates as ISO strings rather than Date
    // objects. The probe should tolerate both shapes without re-parsing.
    observationFindFirst.mockResolvedValue({
      observedAt: "2026-05-26T11:00:00.000Z",
    });

    const result = await getLastInspectionAt(prisma, "NORTH-01", "cattle");

    expect(result).toBe("2026-05-26T11:00:00.000Z");
  });
});

describe("shouldRenderSheepEmptyState(mode, camps)", () => {
  it("returns true for sheep mode + every camp has animal_count === 0 (Trio sheep case)", () => {
    expect(
      shouldRenderSheepEmptyState("sheep", [
        { animal_count: 0 },
        { animal_count: 0 },
        { animal_count: 0 },
      ]),
    ).toBe(true);
  });

  it("returns false for sheep mode + at least one non-zero animal_count", () => {
    expect(
      shouldRenderSheepEmptyState("sheep", [
        { animal_count: 0 },
        { animal_count: 12 },
        { animal_count: 0 },
      ]),
    ).toBe(false);
  });

  it("returns false for cattle mode regardless of counts (gate is sheep-only)", () => {
    expect(
      shouldRenderSheepEmptyState("cattle", [
        { animal_count: 0 },
        { animal_count: 0 },
      ]),
    ).toBe(false);
  });

  it("returns false for game mode regardless of counts (population species)", () => {
    expect(
      shouldRenderSheepEmptyState("game", [
        { animal_count: 0 },
        { animal_count: 0 },
      ]),
    ).toBe(false);
  });

  it("returns false when the camps list is empty (CampSelector already shows its own empty state)", () => {
    expect(shouldRenderSheepEmptyState("sheep", [])).toBe(false);
  });

  it("treats undefined/null animal_count as 0", () => {
    expect(
      shouldRenderSheepEmptyState("sheep", [
        { animal_count: undefined },
        { animal_count: null },
      ]),
    ).toBe(true);
  });
});
