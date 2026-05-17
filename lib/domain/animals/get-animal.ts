/**
 * Wave 309b (ADR-0001 Wave B, #309) — domain op `getAnimal`.
 *
 * Pure read lifted verbatim from `app/api/animals/[id]` GET. Resolves
 * the animal by its unique `animalId` and throws `AnimalNotFoundError`
 * (mapped to the byte-identical legacy 404 `{ error: "Not found" }`)
 * when it does not exist.
 *
 * `prisma.animal.findUnique({ where: { animalId } })` is a unique-key
 * lookup → exempt from `audit-species-where` by construction (the audit
 * only covers `findMany|findFirst|count|groupBy|updateMany|deleteMany`).
 */
import type { PrismaClient } from "@prisma/client";

import { AnimalNotFoundError } from "./errors";

export type AnimalRow = Awaited<
  ReturnType<PrismaClient["animal"]["findUnique"]>
>;

export async function getAnimal(
  prisma: PrismaClient,
  animalId: string,
): Promise<NonNullable<AnimalRow>> {
  const animal = await prisma.animal.findUnique({
    where: { animalId },
  });

  if (!animal) {
    throw new AnimalNotFoundError(animalId);
  }
  return animal;
}
