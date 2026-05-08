/**
 * Wave G1 (#165) — domain helpers `buildSellerSnapshot`,
 * `buildAnimalSnapshot`, `generateNvdNumber`.
 *
 * Moved verbatim from `lib/server/nvd.ts` — no behaviour change, only the
 * import path. `lib/server/nvd.ts` re-exports these for legacy callers
 * (PDF builder, exporters, tests).
 *
 * The snapshot freezes seller + animal identity at issue time; the
 * NvdRecord stores these as JSON strings so a later edit to FarmSettings
 * or animal rows can never alter a previously-issued NVD's content.
 */
import type { PrismaClient } from "@prisma/client";

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
  | {
      ok: false;
      blockers: Array<{
        animalId: string;
        name: string | null;
        campId: string;
        treatmentType: string;
        treatedAt: Date;
        withdrawalDays: number;
        withdrawalEndsAt: Date;
        daysRemaining: number;
      }>;
    };

/**
 * Transport details required by Stock Theft Act 57/1959 §8 when animals are
 * conveyed by vehicle. The driver/transporter name and vehicle registration are
 * mandatory for a roadblock-compliant removal certificate.
 */
export interface NvdTransportDetails {
  driverName: string;
  vehicleRegNumber: string;
  vehicleMakeModel?: string;
}

export interface NvdIssueInput {
  saleDate: string; // YYYY-MM-DD
  buyerName: string;
  buyerAddress?: string;
  buyerContact?: string;
  destinationAddress?: string;
  animalIds: string[]; // animalId values (not DB IDs)
  declarationsJson: string; // JSON string of declaration booleans
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
  year: number,
): Promise<string> {
  const prefix = `NVD-${year}-`;

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

// ── buildSellerSnapshot ───────────────────────────────────────────────────────

/**
 * Reads the FarmSettings singleton and returns a frozen snapshot of the seller
 * identity fields to embed in the NvdRecord at issue time.
 */
export async function buildSellerSnapshot(
  prisma: PrismaClient,
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
 */
export async function buildAnimalSnapshot(
  prisma: PrismaClient,
  animalIds: string[],
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

  const lastMovementMap = new Map<string, string>();
  for (const obs of movements) {
    if (obs.animalId && !lastMovementMap.has(obs.animalId)) {
      lastMovementMap.set(
        obs.animalId,
        obs.observedAt.toISOString().slice(0, 10),
      );
    }
  }

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
