/**
 * lib/server/nvd.ts
 *
 * Pure server-side helpers for the NVD (National Vendor Declaration) generator.
 * All functions accept a PrismaClient (or tx client) so they can be unit-tested
 * without a real database connection.
 */

import type { PrismaClient } from "@prisma/client";
import { getAnimalsInWithdrawal, type WithdrawalAnimal } from "./treatment-analytics";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SellerSnapshot {
  farmName: string;
  ownerName: string;
  ownerIdNumber: string;
  physicalAddress: string;
  postalAddress: string;
  contactPhone: string;
  contactEmail: string;
  propertyRegNumber: string;
  /**
   * DALRRD/BrandsAIS-registered AIA mark (max 3 chars). Required on every
   * NVD/removal certificate per Animal Identification Act 6 of 2002. Distinct
   * asset from `propertyRegNumber` (which is the LPHS property registration).
   * Empty string when not yet registered.
   */
  aiaIdentificationMark: string;
  farmRegion: string;
}

export interface AnimalSnapshotEntry {
  animalId: string;
  name: string | null;
  sex: string;
  breed: string;
  category: string;
  dateOfBirth: string | null;
  lastCampId: string;
  lastMovementDate: string | null;
  /**
   * Per-animal AIA 2002 identification — ear-tag number and brand/tattoo
   * sequence linking to the farm's `aiaIdentificationMark`. Null on legacy
   * NvdRecords issued before wave/26d, or when the farmer has not yet
   * captured these fields.
   */
  tagNumber: string | null;
  brandSequence: string | null;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; blockers: WithdrawalAnimal[] };

/**
 * Transport details required by Stock Theft Act 57/1959 §8 when animals are
 * conveyed by vehicle. The driver/transporter name and vehicle registration are
 * mandatory for a roadblock-compliant removal certificate.
 *
 * Optional at the type level because some movements may be on-foot or not
 * vehicular, but the NVD issue form MUST collect and display these fields.
 */
export interface NvdTransportDetails {
  driverName: string;
  vehicleRegNumber: string;
  vehicleMakeModel?: string;
}

export interface NvdIssueInput {
  saleDate: string;           // YYYY-MM-DD
  buyerName: string;
  buyerAddress?: string;
  buyerContact?: string;
  destinationAddress?: string;
  animalIds: string[];        // animalId values (not DB IDs)
  declarationsJson: string;  // JSON string of 7 declaration booleans
  generatedBy?: string;
  transactionId?: string;
  /** Transport details (driver + vehicle) per Stock Theft Act §8. */
  transport?: NvdTransportDetails;
}

// ── generateNvdNumber ─────────────────────────────────────────────────────────

/**
 * Returns the next NVD number for a given year, formatted as NVD-YYYY-NNNN.
 * Must be called inside a transaction that holds a write lock on NvdRecord.
 *
 * @param txClient — a Prisma transaction client (NOT the root PrismaClient)
 * @param year     — 4-digit year, e.g. 2026
 */
export async function generateNvdNumber(
  txClient: PrismaClient,
  year: number
): Promise<string> {
  const prefix = `NVD-${year}-`;

  // Find the highest-numbered NVD for this year
  const last = await txClient.nvdRecord.findFirst({
    where: {
      nvdNumber: { startsWith: prefix },
    },
    orderBy: { nvdNumber: "desc" },
    select: { nvdNumber: true },
  });

  let next = 1;
  if (last) {
    const seq = parseInt(last.nvdNumber.slice(prefix.length), 10);
    if (!isNaN(seq)) next = seq + 1;
  }

  return `${prefix}${String(next).padStart(4, "0")}`;
}

// ── validateNvdAnimals ────────────────────────────────────────────────────────

/**
 * Checks whether any of the requested animals are inside an active withdrawal
 * period. Returns ok:true if safe, ok:false with the blocking animals otherwise.
 */
export async function validateNvdAnimals(
  prisma: PrismaClient,
  animalIds: string[]
): Promise<ValidationResult> {
  const inWithdrawal = await getAnimalsInWithdrawal(prisma);
  const blockers = inWithdrawal.filter((a) => animalIds.includes(a.animalId));
  if (blockers.length === 0) return { ok: true };
  return { ok: false, blockers };
}

// ── buildSellerSnapshot ───────────────────────────────────────────────────────

/**
 * Reads the FarmSettings singleton and returns a frozen snapshot of the seller
 * identity fields to embed in the NvdRecord at issue time.
 */
export async function buildSellerSnapshot(
  prisma: PrismaClient
): Promise<SellerSnapshot> {
  const settings = await prisma.farmSettings.findFirst();
  return {
    farmName: settings?.farmName ?? "My Farm",
    ownerName: settings?.ownerName ?? "",
    ownerIdNumber: settings?.ownerIdNumber ?? "",
    physicalAddress: settings?.physicalAddress ?? "",
    postalAddress: settings?.postalAddress ?? "",
    contactPhone: settings?.contactPhone ?? "",
    contactEmail: settings?.contactEmail ?? "",
    propertyRegNumber: settings?.propertyRegNumber ?? "",
    aiaIdentificationMark: settings?.aiaIdentificationMark ?? "",
    farmRegion: settings?.farmRegion ?? "",
  };
}

// ── buildAnimalSnapshot ───────────────────────────────────────────────────────

/**
 * Loads each requested animal plus its most-recent animal_movement observation,
 * then freezes the data into a snapshot array.
 *
 * The snapshot is immutable at issue time — re-reading it later must not be
 * affected by subsequent camp moves or edits.
 */
export async function buildAnimalSnapshot(
  prisma: PrismaClient,
  animalIds: string[]
): Promise<AnimalSnapshotEntry[]> {
  if (animalIds.length === 0) return [];

  // cross-species by design: NVD movement docs cover every species per SA regs.
  const animals = await prisma.animal.findMany({
    where: { animalId: { in: animalIds }, status: "Active" },
    select: {
      animalId: true,
      name: true,
      sex: true,
      breed: true,
      category: true,
      dateOfBirth: true,
      currentCamp: true,
      tagNumber: true,
      brandSequence: true,
    },
  });

  // Fetch the most-recent animal_movement observation for each animal
  const movements = await prisma.observation.findMany({
    where: {
      type: "animal_movement",
      animalId: { in: animalIds },
    },
    orderBy: { observedAt: "desc" },
    select: {
      animalId: true,
      observedAt: true,
    },
  });

  // Build a map: animalId -> most-recent movement date
  const lastMovementMap = new Map<string, string>();
  for (const obs of movements) {
    if (obs.animalId && !lastMovementMap.has(obs.animalId)) {
      lastMovementMap.set(obs.animalId, obs.observedAt.toISOString().slice(0, 10));
    }
  }

  // Preserve the requested order
  const animalMap = new Map(animals.map((a) => [a.animalId, a]));
  const snapshots: AnimalSnapshotEntry[] = [];
  for (const id of animalIds) {
    const a = animalMap.get(id);
    if (!a) continue;
    snapshots.push({
      animalId: a.animalId,
      name: a.name ?? null,
      sex: a.sex,
      breed: a.breed,
      category: a.category,
      dateOfBirth: a.dateOfBirth ?? null,
      lastCampId: a.currentCamp,
      lastMovementDate: lastMovementMap.get(a.animalId) ?? null,
      tagNumber: a.tagNumber ?? null,
      brandSequence: a.brandSequence ?? null,
    });
  }

  return snapshots;
}

// ── issueNvd ──────────────────────────────────────────────────────────────────

/**
 * Full transactional issue flow:
 * 1. Validate — block if any animal is in withdrawal
 * 2. Snapshot seller + animals
 * 3. Generate NVD number (sequential, within the transaction)
 * 4. Insert NvdRecord
 * Returns the newly-created NvdRecord id and nvdNumber.
 */
export async function issueNvd(
  prisma: PrismaClient,
  input: NvdIssueInput
): Promise<{ id: string; nvdNumber: string }> {
  // Validate first (outside transaction — read-only check)
  const validation = await validateNvdAnimals(prisma, input.animalIds);
  if (!validation.ok) {
    const names = validation.blockers
      .map((b) => b.animalId + (b.name ? ` (${b.name})` : ""))
      .join(", ");
    throw new Error(`Cannot issue NVD: the following animals are in withdrawal — ${names}`);
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
        transportJson: input.transport ? JSON.stringify(input.transport) : null,
        generatedBy: input.generatedBy ?? null,
      },
      select: { id: true, nvdNumber: true },
    });
  });

  return record;
}

// ── voidNvd ───────────────────────────────────────────────────────────────────

/**
 * Marks an NvdRecord as voided. Does NOT delete — the record is retained for
 * audit trail.
 */
export async function voidNvd(
  prisma: PrismaClient,
  id: string,
  reason: string
): Promise<void> {
  await prisma.nvdRecord.update({
    where: { id },
    data: {
      voidedAt: new Date(),
      voidReason: reason,
    },
  });
}
