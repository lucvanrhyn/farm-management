/**
 * Wave F (#163) — domain op `uploadPhoto`.
 * Wave 1 (#251) — hardened with typed sub-errors, retry-once-on-network,
 * and structured Sentry-style breadcrumbs on every failure path.
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
 * Errors are typed (`lib/domain/photos/errors.ts`); the route handler
 * (`app/api/photos/upload/route.ts`) maps each one onto the canonical
 * 4xx/5xx envelope (`{ error, message }`).
 */
import {
  BlobAccessError,
  BlobError,
  BlobRequestAbortedError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
  BlobStoreSuspendedError,
  put,
} from "@vercel/blob";

import { logger } from "@/lib/logger";

import {
  BlobNetworkError,
  BlobNotConfiguredError,
  BlobQuotaExceededError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
} from "./errors";

/**
 * Hard cap. Wave 1 (#251) raised from 4 MB → 10 MB so a typical 12-MP
 * phone JPEG (~3-5 MB) and a high-detail HEIC (~6-8 MB) both fit without
 * forcing client-side downscaling. Anything > 10 MB is almost always a
 * user-side mistake (raw photo, accidental video) and should be rejected
 * with a clear message.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** MIME allow-list — preserved verbatim from the pre-Wave-F route. */
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

/**
 * Sentry-style structured breadcrumb. Logged via the project logger so it
 * shows up as a single line in Vercel function logs (parseable JSON in
 * prod, friendly object in dev). The `[breadcrumb][photos.upload]` prefix
 * lets ops filter for "every photo upload failure" in one query without
 * sifting through unrelated `[photos/upload]` lines.
 */
function emitFailureBreadcrumb(
  slug: string,
  file: File,
  code: string,
  cause?: unknown,
): void {
  logger.error("[breadcrumb][photos.upload] failure", {
    slug,
    size: file.size,
    contentType: file.type,
    name: file.name,
    code,
    cause,
  });
}

/**
 * Vercel Blob errors we treat as transient (worth one in-process retry).
 * `BlobServiceNotAvailable` = 5xx-class outage; `BlobRequestAbortedError`
 * = client/server abort mid-flight; `TypeError("fetch failed")` = the
 * Node fetch impl barfing on DNS/socket churn — all heal on a retry.
 */
function isTransientNetwork(err: unknown): boolean {
  if (err instanceof BlobServiceNotAvailable) return true;
  if (err instanceof BlobRequestAbortedError) return true;
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused")
    ) {
      return true;
    }
  }
  return false;
}

/** Vercel Blob errors meaning "rate-limited / suspended" — no in-process retry. */
function isQuotaExceeded(err: unknown): boolean {
  return (
    err instanceof BlobServiceRateLimited ||
    err instanceof BlobStoreSuspendedError
  );
}

/**
 * Map an unclassified `@vercel/blob` rejection onto a typed domain error.
 * Network errors are pre-classified by the caller; this helper handles
 * the remaining quota / unknown shapes.
 */
function classifyUploadError(err: unknown): Error {
  if (isQuotaExceeded(err)) return new BlobQuotaExceededError(err);
  if (err instanceof BlobAccessError) return new BlobUploadFailedError(err);
  if (err instanceof BlobError) return new BlobUploadFailedError(err);
  return new BlobUploadFailedError(err);
}

export async function uploadPhoto(
  slug: string,
  file: File,
): Promise<{ url: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    emitFailureBreadcrumb(slug, file, "BLOB_NOT_CONFIGURED");
    throw new BlobNotConfiguredError();
  }

  if (file.size > MAX_FILE_SIZE) {
    emitFailureBreadcrumb(slug, file, "FILE_TOO_LARGE");
    throw new FileTooLargeError(file.size);
  }

  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    emitFailureBreadcrumb(slug, file, "INVALID_FILE_TYPE");
    throw new InvalidFileTypeError(file.type);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `farm-photos/${slug}/${Date.now()}-${safeName}`;

  // Attempt 1.
  try {
    const blob = await put(key, file, { access: "public" });
    return { url: blob.url };
  } catch (firstErr) {
    // Quota and unclassified errors fail fast — no retry.
    if (!isTransientNetwork(firstErr)) {
      const typed = classifyUploadError(firstErr);
      emitFailureBreadcrumb(
        slug,
        file,
        (typed as { code?: string }).code ?? "BLOB_UPLOAD_FAILED",
        firstErr,
      );
      throw typed;
    }

    // Transient network failure — log a warning breadcrumb and retry once.
    logger.warn("[breadcrumb][photos.upload] retry", {
      slug,
      size: file.size,
      contentType: file.type,
      name: file.name,
      attempt: 1,
      cause: firstErr,
    });

    try {
      const blob = await put(key, file, { access: "public" });
      return { url: blob.url };
    } catch (secondErr) {
      // If the retry surfaces a non-network failure (e.g. quota tripped
      // between attempts), surface it as the typed error so the caller
      // can act on the real root cause, not the network blip.
      if (!isTransientNetwork(secondErr)) {
        const typed = classifyUploadError(secondErr);
        emitFailureBreadcrumb(
          slug,
          file,
          (typed as { code?: string }).code ?? "BLOB_UPLOAD_FAILED",
          secondErr,
        );
        throw typed;
      }
      emitFailureBreadcrumb(slug, file, "BLOB_NETWORK_ERROR", secondErr);
      throw new BlobNetworkError(secondErr);
    }
  }
}
