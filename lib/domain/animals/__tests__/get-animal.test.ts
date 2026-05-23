/**
 * @vitest-environment node
 *
 * Wave 309b (ADR-0001 Wave B, #309) — domain op: `getAnimal`.
 *
 * Lifted verbatim from `app/api/animals/[id]` GET. Resolves the animal by
 * its unique `animalId` via `findUnique` (the `[id]` calls are unique-key,
 * so audit-species-where exempt by construction). Throws
 * `AnimalNotFoundError` (wire 404 `{ error: "Not found" }`) when missing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { getAnimal } from "../get-animal";
import { AnimalNotFoundError } from "../errors";

describe("getAnimal(prisma, animalId)", () => {
  const animalFindUnique = vi.fn();
  const prisma = {
    animal: { findUnique: animalFindUnique },
  } as unknown as PrismaClient;

  beforeEach(() => {
    animalFindUnique.mockReset();
  });

  it("resolves the animal by its unique animalId", async () => {
    const row = { animalId: "A-1", species: "cattle", status: "Active" };
    animalFindUnique.mockResolvedValue(row);

    const result = await getAnimal(prisma, "A-1");

    expect(result).toBe(row);
    expect(animalFindUnique).toHaveBeenCalledWith({
      where: { animalId: "A-1" },
    });
  });

  it("throws AnimalNotFoundError when the animal does not exist", async () => {
    animalFindUnique.mockResolvedValue(null);

    await expect(getAnimal(prisma, "MISSING")).rejects.toBeInstanceOf(
      AnimalNotFoundError,
    );
  });

  it("carries the looked-up animalId on the thrown error", async () => {
    animalFindUnique.mockResolvedValue(null);

    await expect(getAnimal(prisma, "MISSING")).rejects.toMatchObject({
      animalId: "MISSING",
    });
  });
});
