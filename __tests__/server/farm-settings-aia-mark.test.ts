/**
 * __tests__/server/farm-settings-aia-mark.test.ts
 *
 * TDD tests for wave/26d (refs #26):
 *   AIA Identification Mark on FarmSettings.
 *
 * Legal basis: Animal Identification Act 6 of 2002 — every commercial farm
 * must register a 3-character identification mark with DALRRD/BrandsAIS, and
 * surface it on every NVD / removal certificate.
 *
 * These tests assert the buildSellerSnapshot helper round-trips the new
 * `aiaIdentificationMark` field. The HTTP layer is covered indirectly via
 * the existing settings route — this layer is what the NVD pipeline reads.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    nvdRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    observation: { findMany: vi.fn().mockResolvedValue([]) },
    animal: { findMany: vi.fn().mockResolvedValue([]) },
    farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
    ...overrides,
  } as unknown as PrismaClient;
}

describe("buildSellerSnapshot — AIA identification mark", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("includes aiaIdentificationMark when set on FarmSettings", async () => {
    const { buildSellerSnapshot } = await import("@/lib/server/nvd");
    const prisma = makeMockPrisma({
      farmSettings: {
        findFirst: vi.fn().mockResolvedValue({
          farmName: "Doornhoek",
          ownerName: "Jan van Niekerk",
          ownerIdNumber: "8001015009087",
          physicalAddress: "Plaas Doornhoek",
          postalAddress: "",
          contactPhone: "",
          contactEmail: "",
          propertyRegNumber: "LP-2024-001",
          aiaIdentificationMark: "JVN",
          farmRegion: "Limpopo",
        }),
      },
    });

    const snapshot = await buildSellerSnapshot(prisma);
    expect(snapshot.aiaIdentificationMark).toBe("JVN");
  });

  it("returns empty string when aiaIdentificationMark is null", async () => {
    const { buildSellerSnapshot } = await import("@/lib/server/nvd");
    const prisma = makeMockPrisma({
      farmSettings: {
        findFirst: vi.fn().mockResolvedValue({
          farmName: "My Farm",
          ownerName: null,
          ownerIdNumber: null,
          physicalAddress: null,
          postalAddress: null,
          contactPhone: null,
          contactEmail: null,
          propertyRegNumber: null,
          aiaIdentificationMark: null,
          farmRegion: null,
        }),
      },
    });

    const snapshot = await buildSellerSnapshot(prisma);
    expect(snapshot.aiaIdentificationMark).toBe("");
  });

  it("returns empty string when settings row is absent", async () => {
    const { buildSellerSnapshot } = await import("@/lib/server/nvd");
    const prisma = makeMockPrisma({
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    const snapshot = await buildSellerSnapshot(prisma);
    expect(snapshot.aiaIdentificationMark).toBe("");
  });
});
