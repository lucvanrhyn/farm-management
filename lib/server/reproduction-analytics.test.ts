// lib/server/reproduction-analytics.test.ts
//
// Issue #356 — getReproStats() is the CATTLE-grounded reproduction engine
// behind /admin/reproduction (285d gestation, calving/insemination/
// heat_detection observation semantics, SA cattle benchmarks). On a
// sheep/game tenant the admin reproduction page passes the active mode
// (`{ species: mode }`); historically the engine discarded that option and
// always read `scoped(prisma, "cattle")`, so a sheep/game farm saw
// cattle-derived KPI cards under a "Lambing"/"Fawning" label.
//
// The species-correct sheep reproduction surface lives separately
// (`/sheep/reproduction` → `sheepModule.getReproStats`, lambing/joining
// semantics). Game has no reproduction-event vocabulary at all. So the only
// safe behaviour for the cattle engine on a non-cattle mode is to GATE:
// return a typed not-available shape WITHOUT running any cattle query —
// never fabricated/cattle numbers under a non-cattle label.
//
// These tests lock both halves of the contract:
//   (1) species:"sheep"/"game" → gated empty shape, ZERO DB reads.
//   (2) species:"cattle" / no-arg → unchanged: the engine reads the DB.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getReproStats } from "./reproduction-analytics";

// Minimal fake Prisma: the engine touches observation.findMany, camp.findMany
// and animal.findMany (the active roster, intersected into upcomingCalvings).
// Each is a spy resolving an empty result so the cattle path runs to completion
// without a real DB.
function makeFakePrisma() {
  const observationFindMany = vi.fn().mockResolvedValue([]);
  const campFindMany = vi.fn().mockResolvedValue([]);
  const animalFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    observation: { findMany: observationFindMany },
    camp: { findMany: campFindMany },
    animal: { findMany: animalFindMany },
  } as unknown as PrismaClient;
  return { prisma, observationFindMany, campFindMany, animalFindMany };
}

describe("getReproStats — species scope (#356)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("non-cattle species are gated (never cattle-derived numbers)", () => {
    it("returns a not-available shape for species:'sheep' and runs NO cattle query", async () => {
      const { prisma, observationFindMany, campFindMany } = makeFakePrisma();

      const stats = await getReproStats(prisma, { species: "sheep" });

      // Gated discriminant — the page renders an explicit empty state off this.
      expect(stats.available).toBe(false);

      // No cattle query may run for a non-cattle mode. This is the load-bearing
      // guarantee: zero reads ⇒ nothing cattle-derived can leak through.
      expect(observationFindMany).not.toHaveBeenCalled();
      expect(campFindMany).not.toHaveBeenCalled();

      // And the payload itself carries no numbers that could be rendered.
      expect(stats.pregnancyRate).toBeNull();
      expect(stats.calvingRate).toBeNull();
      expect(stats.avgCalvingIntervalDays).toBeNull();
      expect(stats.avgDaysOpen).toBeNull();
      expect(stats.weaningRate).toBeNull();
      expect(stats.conceptionRate).toBeNull();
      expect(stats.upcomingCalvings).toEqual([]);
      expect(stats.pregnancyRateByCycle).toEqual([]);
      expect(stats.daysOpen).toEqual([]);
      expect(stats.scanCounts).toEqual({ pregnant: 0, empty: 0, uncertain: 0 });
      expect(stats.inHeat7d).toBe(0);
      expect(stats.inseminations30d).toBe(0);
      expect(stats.calvingsDue30d).toBe(0);
    });

    it("returns a not-available shape for species:'game' and runs NO cattle query", async () => {
      const { prisma, observationFindMany, campFindMany } = makeFakePrisma();

      const stats = await getReproStats(prisma, { species: "game" });

      expect(stats.available).toBe(false);
      expect(observationFindMany).not.toHaveBeenCalled();
      expect(campFindMany).not.toHaveBeenCalled();
    });
  });

  describe("cattle behaviour is unchanged", () => {
    it("runs the cattle queries and reports available for species:'cattle'", async () => {
      const { prisma, observationFindMany, campFindMany } = makeFakePrisma();

      const stats = await getReproStats(prisma, { species: "cattle" });

      // The cattle engine actually reads the DB (repro obs, calving obs, camps).
      expect(observationFindMany).toHaveBeenCalled();
      expect(campFindMany).toHaveBeenCalled();
      expect(stats.available).toBe(true);
    });

    it("runs the cattle queries and reports available when no species option is given", async () => {
      const { prisma, observationFindMany, campFindMany } = makeFakePrisma();

      const stats = await getReproStats(prisma);

      expect(observationFindMany).toHaveBeenCalled();
      expect(campFindMany).toHaveBeenCalled();
      expect(stats.available).toBe(true);
    });
  });
});
