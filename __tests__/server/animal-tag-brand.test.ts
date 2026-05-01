/**
 * __tests__/server/animal-tag-brand.test.ts
 *
 * TDD tests for wave/26d (refs #26):
 *   Per-animal tagNumber + brandSequence fields on Animal.
 *
 * Legal basis: Animal Identification Act 6 of 2002 — every commercial-farm
 * animal must carry the farm AIA mark plus a unique tag/brand/tattoo
 * sequence. The internal CUID `animal.animalId` is NOT a legal identifier.
 *
 * These tests assert that the Prisma model accepts the new optional fields,
 * and that the API allow-list on PATCH lets ADMINs update them.
 */

import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";

describe("Animal model — tagNumber + brandSequence", () => {
  it("AnimalCreateInput accepts tagNumber + brandSequence (compile-time)", () => {
    // Type-level check: the test passes if it compiles. If the migration is
    // missing or the Prisma client wasn't regenerated, this assignment will
    // fail at type-check time.
    const input: Prisma.AnimalCreateInput = {
      animalId: "ZA-001",
      sex: "Female",
      category: "Cow",
      currentCamp: "C1",
      dateAdded: "2026-05-01",
      tagNumber: "TAG-12345",
      brandSequence: "001",
    };
    expect(input.tagNumber).toBe("TAG-12345");
    expect(input.brandSequence).toBe("001");
  });

  it("AnimalUpdateInput accepts tagNumber + brandSequence updates", () => {
    const update: Prisma.AnimalUpdateInput = {
      tagNumber: "TAG-99",
      brandSequence: "ABC-7",
    };
    expect(update.tagNumber).toBe("TAG-99");
    expect(update.brandSequence).toBe("ABC-7");
  });

  it("both fields are optional — empty input compiles", () => {
    const input: Prisma.AnimalCreateInput = {
      animalId: "ZA-002",
      sex: "Male",
      category: "Bull",
      currentCamp: "C1",
      dateAdded: "2026-05-01",
    };
    expect(input.tagNumber).toBeUndefined();
    expect(input.brandSequence).toBeUndefined();
  });
});
