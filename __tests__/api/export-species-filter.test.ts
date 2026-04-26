/**
 * __tests__/api/export-species-filter.test.ts
 *
 * Regression tests for the codex round-1 MEDIUM finding:
 *   Animal export must honour `?species=<mode>` when present, and preserve
 *   cross-species behaviour when the param is absent.
 *
 * TDD RED phase: written BEFORE any production code change.
 *
 * Expected failure reason:
 *   - "sheep-only returns only sheep" — FAILS because today the query has no
 *     species filter so it returns all species in the seed data.
 *   - "invalid species returns 400" — FAILS because the route does not yet
 *     parse/validate `?species=`.
 *
 * The other two cases (no-species = cross-species, non-animal export ignores
 * species) are already implicitly true but are pinned as regression tests.
 *
 * Test strategy: unit-test the exporter function directly (exportAnimals) and
 * the route-level validation via the exported helpers, avoiding HTTP layer
 * machinery (no real Next.js server needed). ExportContext.url carries the
 * full URL including search params, which is how the exporter receives them.
 */

import { describe, it, expect, vi } from "vitest";
import type { ExportContext } from "@/lib/server/export/types";
import { exportAnimals } from "@/lib/server/export/animals";
import { exportCamps } from "@/lib/server/export/camps";

// ── Prisma mock helpers ───────────────────────────────────────────────────────

/** Minimal animal shape matching what the exporter reads. */
function makeAnimal(animalId: string, species: string, status = "Active") {
  return {
    animalId,
    name: `Animal ${animalId}`,
    species,
    status,
    sex: "Female",
    breed: "Mixed",
    category: "Cow",
    currentCamp: "Camp A",
    dateOfBirth: "2022-01-01",
    dateAdded: "2022-01-15",
  };
}

const SEED_ANIMALS = [
  makeAnimal("C001", "cattle"),
  makeAnimal("C002", "cattle"),
  makeAnimal("S001", "sheep"),
  makeAnimal("S002", "sheep"),
  makeAnimal("G001", "game"),
];

function makeMockPrisma(animals = SEED_ANIMALS) {
  return {
    animal: {
      findMany: vi.fn().mockImplementation(({ where }: { where?: { species?: string; status?: string } }) => {
        let result = animals;
        if (where?.status) {
          result = result.filter((a) => a.status === where.status);
        }
        if (where?.species) {
          result = result.filter((a) => a.species === where.species);
        }
        return Promise.resolve(result);
      }),
    },
    camp: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as ExportContext["prisma"];
}

function makeCtx(
  searchParamString: string,
  prisma?: ExportContext["prisma"],
): ExportContext {
  const url = new URL(`http://localhost/api/test-farm/export?type=animals${searchParamString}`);
  return {
    prisma: prisma ?? makeMockPrisma(),
    format: "csv" as const,
    url,
    from: null,
    to: null,
  };
}

// ── Case 1: ?species=sheep returns only sheep ────────────────────────────────
// RED: today exportAnimals ignores the species param → returns all 5 animals
//      so the "every animal is a sheep" assertion will FAIL.

describe("exportAnimals — ?species= filter", () => {
  it("returns only sheep when ?species=sheep is set", async () => {
    const ctx = makeCtx("&species=sheep");
    const artifact = await exportAnimals(ctx);

    // Parse the CSV body to inspect which animals came back.
    const body = artifact.body as string;
    const lines = body.trim().split("\n").slice(1); // strip header row

    // Every data row must contain "S0" (sheep IDs are S001, S002 in seed data)
    // and no cattle (C0xx) or game (G0xx) ids should appear.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/S00/);
      expect(line).not.toMatch(/C00/);
      expect(line).not.toMatch(/G00/);
    }
  });

  it("returns all active animals (cross-species) when no ?species= param", async () => {
    const ctx = makeCtx(""); // no species param
    const artifact = await exportAnimals(ctx);

    const body = artifact.body as string;
    const lines = body.trim().split("\n").slice(1);

    // Seed has 2 cattle + 2 sheep + 1 game = 5 animals
    expect(lines.length).toBe(5);
  });

  it("returns only cattle when ?species=cattle is set", async () => {
    const ctx = makeCtx("&species=cattle");
    const artifact = await exportAnimals(ctx);

    const body = artifact.body as string;
    const lines = body.trim().split("\n").slice(1);

    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line).toMatch(/C00/);
    }
  });
});

// ── Case 2: invalid ?species= returns ExportRequestError(400) ───────────────
// RED: today there is no validation → no error is thrown, test FAILS.

import { ExportRequestError } from "@/lib/server/export/types";

describe("exportAnimals — invalid species param", () => {
  it("throws ExportRequestError(400) for an unrecognised species", async () => {
    const ctx = makeCtx("&species=zebra");

    await expect(exportAnimals(ctx)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExportRequestError && err.status === 400,
    );
  });
});

// ── Case 3: other resource exporters ignore ?species= without error ──────────
// Regression pin: camps exporter must not blow up when species is in URL.

describe("exportCamps — unrelated exporter ignores ?species=", () => {
  it("returns a CSV without error when ?species=sheep is in the URL", async () => {
    // camps exporter calls camp.findMany + observation.findMany (via getLatestCampConditions)
    const prisma = {
      camp: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      observation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as ExportContext["prisma"];

    const url = new URL("http://localhost/api/test-farm/export?type=camps&species=sheep");
    const ctx: ExportContext = { prisma, format: "csv", url, from: null, to: null };

    // Should resolve cleanly — no throw
    const artifact = await exportCamps(ctx);
    expect(artifact.contentType).toBe("text/csv");
  });
});
