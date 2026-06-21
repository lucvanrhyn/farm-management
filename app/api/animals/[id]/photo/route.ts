/**
 * PATCH /api/animals/[id]/photo — set an animal's PRIMARY profile photo.
 *
 * Distinct from `app/api/animals/[id]/photos` (note the trailing "s"):
 *   - `/photos` (POST) appends to the multi-photo GALLERY by creating a
 *     `camp_check` Observation carrying an `attachmentUrl`.
 *   - `/photo`  (PATCH, this file) sets the SINGLE primary image column
 *     `Animal.photoUrl` (added in migration 0030). This is the animal's
 *     profile picture, not a gallery entry.
 *
 * Workflow:
 *   1. Resolve the tenant via `tenantWrite` (auth + per-tenant prisma).
 *   2. Look up the animal by `animalId` (existence check).
 *   3. Push the file through `uploadPhoto` (the hardened PhotoUploadGateway)
 *      to Vercel Blob — typed errors bubble up here.
 *   4. Persist the resulting URL to `Animal.photoUrl`.
 *
 * Wire shapes (mirrors `app/api/animals/[id]/photos/route.ts`):
 *   - 200 → `{ success: true, photoUrl }`
 *   - 400 → `{ error: "MISSING_FILE", message }`
 *   - 404 → `{ error: "ANIMAL_NOT_FOUND", message }`
 *   - 413 → `{ error: "FILE_TOO_LARGE", message, details: { size } }`
 *   - 415 → `{ error: "INVALID_FILE_TYPE", message, details: { type } }`
 *   - 502 → `{ error: "BLOB_UPLOAD_FAILED", message }`
 *   - 503 → `{ error: "BLOB_NOT_CONFIGURED" | "BLOB_QUOTA_EXCEEDED" |
 *                       "BLOB_NETWORK_ERROR", message }`
 */
import { NextResponse } from 'next/server';

import { tenantWrite, routeError } from '@/lib/server/route';
import { revalidateAnimalWrite } from '@/lib/server/revalidate';
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

export const PATCH = tenantWrite<unknown, { id: string }>({
  revalidate: revalidateAnimalWrite,
  handle: async (ctx, _body, req, params) => {
    const { prisma, slug } = ctx;

    const animal = await prisma.animal.findUnique({
      where: { animalId: params.id },
      select: { animalId: true },
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

      await prisma.animal.update({
        where: { animalId: animal.animalId },
        data: { photoUrl: url },
      });

      return NextResponse.json({ success: true, photoUrl: url });
    } catch (err) {
      const mapped = mapPhotoError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
});
