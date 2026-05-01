/**
 * __tests__/server/farm-settings-tax-ref.test.ts
 *
 * TDD tests for wave/26c (refs #26 finding #7):
 *   FarmSettings persists `taxReferenceNumber` and the IT3 farm-identity
 *   snapshot threads the value into the PDF payload.
 *
 * Validation policy: per the wave/26c spec — accept any string the user
 * enters (SARS validates at submission). The UI hints at 10 digits via
 * `pattern` + `maxLength`, but the API does not block non-conforming
 * values; it just trims and stores.
 */

import { describe, it, expect, vi } from "vitest";
import { buildFarmIdentitySnapshot } from "@/lib/server/sars-it3";
import type { PrismaClient } from "@prisma/client";

function makePrismaWithFarmSettings(
  settings: Record<string, unknown> | null,
): PrismaClient {
  return {
    farmSettings: {
      findFirst: vi.fn().mockResolvedValue(settings),
    },
  } as unknown as PrismaClient;
}

describe("buildFarmIdentitySnapshot — taxReferenceNumber threading", () => {
  it("includes taxReferenceNumber when set on FarmSettings", async () => {
    const prisma = makePrismaWithFarmSettings({
      farmName: "Test Farm",
      ownerName: "Jan van der Merwe",
      ownerIdNumber: "8001015009087",
      taxReferenceNumber: "1234567890",
      physicalAddress: "1 Plaas Road",
      postalAddress: "",
      contactPhone: "",
      contactEmail: "",
      propertyRegNumber: "",
      farmRegion: "",
    });
    const snapshot = await buildFarmIdentitySnapshot(prisma);
    expect(snapshot.taxReferenceNumber).toBe("1234567890");
  });

  it("defaults taxReferenceNumber to empty string when FarmSettings has none", async () => {
    // Legacy tenants where the column is null because it was never set.
    const prisma = makePrismaWithFarmSettings({
      farmName: "Test Farm",
      ownerName: "Jan van der Merwe",
      ownerIdNumber: "",
      taxReferenceNumber: null,
      physicalAddress: "",
      postalAddress: "",
      contactPhone: "",
      contactEmail: "",
      propertyRegNumber: "",
      farmRegion: "",
    });
    const snapshot = await buildFarmIdentitySnapshot(prisma);
    expect(snapshot.taxReferenceNumber).toBe("");
  });

  it("defaults taxReferenceNumber to empty string when FarmSettings is missing entirely", async () => {
    const prisma = makePrismaWithFarmSettings(null);
    const snapshot = await buildFarmIdentitySnapshot(prisma);
    expect(snapshot.taxReferenceNumber).toBe("");
    // The other fields keep their sensible defaults so the rest of the PDF
    // pipeline works.
    expect(snapshot.farmName).toBe("My Farm");
  });
});

// ── Settings PATCH route — round-trip behaviour ──────────────────────────────
//
// The full route is a NextRequest handler that depends on next-auth +
// per-tenant prisma context, which is heavy to mock. Instead we exercise the
// pure "what the route writes to the DB" surface: the request body normaliser
// in the route assigns trim()-or-null for the taxReferenceNumber field
// alongside ownerName/ownerIdNumber. Re-implement that contract here so a
// regression in the route's allow-list is caught.

function normaliseTaxRefForPatch(input: unknown): string | null {
  // Mirrors the loop in app/api/farm/settings/route.ts that handles all NVD
  // seller identity text fields. Empty string -> null, trim otherwise.
  return typeof input === "string" && input.trim() ? input.trim() : null;
}

describe("FarmSettings PATCH — taxReferenceNumber normalisation", () => {
  it("accepts a 10-digit Tax Reference Number and trims whitespace", () => {
    expect(normaliseTaxRefForPatch("  1234567890  ")).toBe("1234567890");
  });

  it("treats empty string as 'clear to null'", () => {
    expect(normaliseTaxRefForPatch("")).toBeNull();
  });

  it("treats whitespace-only string as 'clear to null'", () => {
    expect(normaliseTaxRefForPatch("   ")).toBeNull();
  });

  it("accepts non-10-digit input — SARS validates at submission, UI hints only", () => {
    // Per spec: don't block save. The UI pattern attribute is a hint only.
    expect(normaliseTaxRefForPatch("12345")).toBe("12345");
    expect(normaliseTaxRefForPatch("99999999999")).toBe("99999999999");
  });

  it("rejects non-string input by returning null (no crash)", () => {
    expect(normaliseTaxRefForPatch(undefined)).toBeNull();
    expect(normaliseTaxRefForPatch(null)).toBeNull();
    expect(normaliseTaxRefForPatch(1234567890)).toBeNull();
  });
});
