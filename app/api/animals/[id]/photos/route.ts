/**
 * Wave 5a / issue #264 — admin animal-detail Photos tab upload route.
 *
 * POST /api/animals/[id]/photos
 *   multipart/form-data: { file: File }
 *
 * Workflow:
 *   1. Resolve the tenant via `tenantWrite` (auth + per-tenant prisma).
 *   2. Look up the animal by `animalId` so we know its currentCamp +
 *      species (the new Observation row needs both for downstream
 *      filtering / the species-scoped facade).
 *   3. Push the file through `uploadPhoto` (the hardened
 *      PhotoUploadGateway from #251) to Vercel Blob — typed errors
 *      (`FILE_TOO_LARGE`, `INVALID_FILE_TYPE`, `BLOB_NETWORK_ERROR`,
 *      `BLOB_QUOTA_EXCEEDED`) bubble up here.
 *   4. Persist a `camp_check`-typed Observation tied to the animal,
 *      carrying the resulting attachmentUrl. We deliberately reuse an
 *      existing observation type (`camp_check` is the most generic in
 *      `SHARED_OBSERVATION_TYPES`) so this feature does NOT introduce a
 *      new ObservationType union member — that would ripple into every
 *      logger form, validator, and species registry. The
 *      `details.note: 'Photo uploaded from admin'` marker disambiguates
 *      these rows from real camp checks if a future caller needs it.
 *
 * Wire shapes (mirrors `app/api/photos/upload/route.ts`):
 *   - 200 → `{ success: true, attachmentUrl, observationId }`
 *   - 400 → `{ error: "MISSING_FILE", message }`
 *   - 404 → `{ error: "ANIMAL_NOT_FOUND", message }`
 *   - 413 → `{ error: "FILE_TOO_LARGE", message, details: { size } }`
 *   - 415 → `{ error: "INVALID_FILE_TYPE", message, details: { type } }`
 *   - 502 → `{ error: "BLOB_UPLOAD_FAILED", message }`
 *   - 503 → `{ error: "BLOB_NOT_CONFIGURED" | "BLOB_QUOTA_EXCEEDED" |
 *                       "BLOB_NETWORK_ERROR", message }`
 *
 * GET /api/animals/[id]/photos
 *   Returns the same aggregation that the server page reads — exposed
 *   so client surfaces (future mobile shell, Einstein photo retrieval)
 *   can fetch without a server round-trip. Wire:
 *     - 200 → `{ photos: AnimalPhotoRow[] }`
 *     - 404 → `{ error: "ANIMAL_NOT_FOUND" }`
 */
import { NextResponse } from 'next/server';

import { tenantRead, tenantWrite, routeError } from '@/lib/server/route';
import { revalidateAnimalWrite } from '@/lib/server/revalidate';
import { getAnimalPhotos } from '@/lib/server/animal-photos';
import {
  BlobNetworkError,
  BlobNotConfiguredError,
  BlobQuotaExceededError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
  MissingFileError,
  uploadPhoto,
} from '@/lib/domain/photos';

function mapPhotoError(err: unknown): NextResponse | null {
  if (err instanceof MissingFileError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 400 },
    );
  }
  if (err instanceof FileTooLargeError) {
    return NextResponse.json(
      { error: err.code, message: err.message, details: { size: err.size } },
      { status: 413 },
    );
  }
  if (err instanceof InvalidFileTypeError) {
    return NextResponse.json(
      { error: err.code, message: err.message, details: { type: err.type } },
      { status: 415 },
    );
  }
  if (err instanceof BlobNotConfiguredError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 503 },
    );
  }
  if (err instanceof BlobQuotaExceededError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 503 },
    );
  }
  if (err instanceof BlobNetworkError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 503 },
    );
  }
  if (err instanceof BlobUploadFailedError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 502 },
    );
  }
  return null;
}

export const GET = tenantRead<{ id: string }>({
  handle: async (ctx, _req, params) => {
    const { prisma } = ctx;
    const animal = await prisma.animal.findUnique({
      where: { animalId: params.id },
      select: { animalId: true },
    });
    if (!animal) {
      return routeError('ANIMAL_NOT_FOUND', 'Animal not found', 404);
    }
    const photos = await getAnimalPhotos(prisma, params.id);
    return NextResponse.json({ photos });
  },
});

export const POST = tenantWrite<unknown, { id: string }>({
  revalidate: revalidateAnimalWrite,
  handle: async (ctx, _body, req, params) => {
    const { prisma, slug } = ctx;

    const animal = await prisma.animal.findUnique({
      where: { animalId: params.id },
      select: { animalId: true, currentCamp: true, species: true },
    });
    if (!animal) {
      return routeError('ANIMAL_NOT_FOUND', 'Animal not found', 404);
    }

    try {
      const formData = await req.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) {
        throw new MissingFileError();
      }
      const { url } = await uploadPhoto(slug, file);

      const observation = await prisma.observation.create({
        data: {
          type: 'camp_check',
          campId: animal.currentCamp,
          animalId: animal.animalId,
          species: animal.species,
          details: JSON.stringify({ note: 'Photo uploaded from admin' }),
          observedAt: new Date(),
          loggedBy: ctx.session.user?.email ?? ctx.session.user?.name ?? 'admin',
          attachmentUrl: url,
        },
        select: { id: true, attachmentUrl: true },
      });

      return NextResponse.json({
        success: true,
        attachmentUrl: observation.attachmentUrl,
        observationId: observation.id,
      });
    } catch (err) {
      const mapped = mapPhotoError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
});
