/**
 * Wave G1 (#165) — domain op `issueNvd`.
 *
 * Full transactional issue flow:
 *   1. Validate — block if any animal is in withdrawal
 *      (throws `InvalidAnimalIdsError` on blockers).
 *   2. Snapshot seller + animals.
 *   3. Generate NVD number sequentially inside the transaction.
 *   4. Insert NvdRecord.
 *
 * Behaviour preserved verbatim from `lib/server/nvd.ts::issueNvd` — only
 * the in-withdrawal blocker path now throws a typed error
 * (`InvalidAnimalIdsError`) rather than a bare `Error`. The route adapter
 * maps the typed error onto the wire envelope.
 */
import type { PrismaClient } from "@prisma/client";

import { InvalidAnimalIdsError } from "./errors";
import {
  buildAnimalSnapshot,
  buildSellerSnapshot,
  generateNvdNumber,
  type NvdIssueInput,
} from "./snapshot";
import { validateNvdAnimals } from "./validate";

export async function issueNvd(
  prisma: PrismaClient,
  input: NvdIssueInput,
): Promise<{ id: string; nvdNumber: string }> {
  // Validate first (outside transaction — read-only check)
  const validation = await validateNvdAnimals(prisma, input.animalIds);
  if (!validation.ok) {
    const ids = validation.blockers.map((b) => b.animalId);
    const names = validation.blockers
      .map((b) => b.animalId + (b.name ? ` (${b.name})` : ""))
      .join(", ");
    throw new InvalidAnimalIdsError(
      ids,
      `Cannot issue NVD: the following animals are in withdrawal — ${names}`,
    );
  }

  const [sellerSnapshot, animalSnapshot] = await Promise.all([
    buildSellerSnapshot(prisma),
    buildAnimalSnapshot(prisma, input.animalIds),
  ]);

  const year = new Date().getFullYear();

  const record = await prisma.$transaction(async (tx) => {
    const txClient = tx as unknown as PrismaClient;
    const nvdNumber = await generateNvdNumber(txClient, year);

    return txClient.nvdRecord.create({
      data: {
        nvdNumber,
        saleDate: input.saleDate,
        transactionId: input.transactionId ?? null,
        buyerName: input.buyerName,
        buyerAddress: input.buyerAddress ?? null,
        buyerContact: input.buyerContact ?? null,
        destinationAddress: input.destinationAddress ?? null,
        animalIds: JSON.stringify(input.animalIds),
        animalSnapshot: JSON.stringify(animalSnapshot),
        sellerSnapshot: JSON.stringify(sellerSnapshot),
        declarationsJson: input.declarationsJson,
        transportJson: input.transport
          ? JSON.stringify(input.transport)
          : null,
        generatedBy: input.generatedBy ?? null,
      },
      select: { id: true, nvdNumber: true },
    });
  });

  return record;
}
