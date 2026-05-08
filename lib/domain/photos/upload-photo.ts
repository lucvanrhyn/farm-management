/**
 * Wave F (#163) — domain op `uploadPhoto`.
 *
 * Pre-Wave-F home: `app/api/photos/upload/route.ts` POST. Pure
 * infrastructure op — does NOT touch Prisma. Validates env, file size, and
 * MIME type, then delegates to `@vercel/blob` `put()` under the canonical
 * key `farm-photos/{slug}/{ts}-{safeName}`.
 *
 * The route layer reads `req.formData()` and supplies the `File`; this op
 * is purposely Prisma-free so a future migration to S3 / a sibling blob
 * provider only needs to swap one import.
 *
 * Errors are typed (`lib/domain/photos/errors.ts`) and mapped to canonical
 * status codes via `mapApiDomainError`.
 */
import { put } from "@vercel/blob";

import { logger } from "@/lib/logger";

import {
  BlobNotConfiguredError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
} from "./errors";

/** Hard cap — the pre-Wave-F route enforced 4 MB. Preserved verbatim. */
const MAX_FILE_SIZE = 4 * 1024 * 1024;

/** MIME allow-list — preserved verbatim from the pre-Wave-F route. */
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export async function uploadPhoto(
  slug: string,
  file: File,
): Promise<{ url: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    logger.error("[photos/upload] BLOB_READ_WRITE_TOKEN is not configured");
    throw new BlobNotConfiguredError();
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new FileTooLargeError(file.size);
  }

  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    throw new InvalidFileTypeError(file.type);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `farm-photos/${slug}/${Date.now()}-${safeName}`;

  try {
    const blob = await put(key, file, { access: "public" });
    return { url: blob.url };
  } catch (err) {
    logger.error("[photos/upload] Blob upload failed", err);
    throw new BlobUploadFailedError(err);
  }
}
