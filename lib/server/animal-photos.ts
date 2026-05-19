/**
 * lib/server/animal-photos.ts
 *
 * Wave 5a / issue #264 — admin animal-detail Photos tab.
 *
 * Photo aggregation query. Photos in FarmTrack live as
 * `Observation.attachmentUrl` strings on observation rows of any type
 * (Health, Treatment, Calving, Death, …) — there is no dedicated `Photo`
 * table. The Photos tab on the admin animal-detail page therefore reads
 * every observation tied to the animal that carries a non-null
 * `attachmentUrl`, ordered by capture timestamp descending.
 *
 * Per the species-access invariant (ADR-0003 / ADR-0005): this query
 * filters by `animalId` (single-animal axis), which is intrinsically
 * scoped on a per-tenant DB, and goes through the `crossSpecies()`
 * door so the structural arch test recognises it. Sibling animal-id
 * observation reads on the same page
 * (`app/[farmSlug]/admin/animals/[id]/page.tsx`) use the door for the
 * same reason.
 *
 * Per audit-findmany-no-select: the query projects exactly the four
 * columns the photo tile renders (`id`, `type`, `observedAt`,
 * `attachmentUrl`) — no wasteful `details` / `editHistory` reads.
 */
import type { PrismaClient } from '@prisma/client';
import { crossSpecies } from '@/lib/server/species-scoped-prisma';

/** Hard cap on photos returned per animal. Realistic upper bound for an
 * animal lifetime is ~50 photos (one per Health/Treatment/Calving
 * observation across ~10y); 500 absorbs heavy-photographer outliers
 * without a runaway payload. */
export const PHOTO_LIST_HARD_CAP = 500;

export interface AnimalPhotoRow {
  id: string;
  type: string;
  observedAt: Date;
  attachmentUrl: string | null;
}

/**
 * Returns every observation row for the given animal that carries a
 * non-null attachmentUrl, ordered newest-first.
 *
 * @param prisma   tenant-scoped Prisma client
 * @param animalId the animal's `animalId` (e.g. `BB-C013`)
 */
export async function getAnimalPhotos(
  prisma: PrismaClient,
  animalId: string,
): Promise<AnimalPhotoRow[]> {
  // The animal row itself carries the species axis; aggregating photos by
  // animalId is intrinsically scoped (a single animal belongs to one
  // species), so this goes through the cross-species door.
  const rows = await crossSpecies(
    prisma,
    'species-registry-internal',
  ).observation.findMany({
    where: {
      animalId,
      attachmentUrl: { not: null },
    },
    orderBy: { observedAt: 'desc' },
    take: PHOTO_LIST_HARD_CAP,
    select: {
      id: true,
      type: true,
      observedAt: true,
      attachmentUrl: true,
    },
  });
  return rows;
}
