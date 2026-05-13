/**
 * Wave F (#163) — public surface of the photos domain ops.
 * Wave 1 (#251) — extended with `BlobTokenMissingError`,
 * `BlobQuotaExceededError`, `BlobNetworkError` typed errors and a
 * module-load startup invariant for `BLOB_READ_WRITE_TOKEN`.
 *
 * Pure infrastructure surface — no Prisma. The transport adapter at
 * `app/api/photos/upload/route.ts` wraps the typed errors onto the wire
 * envelope.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-163-comms-surfaces.md`.
 */
import { logger } from "@/lib/logger";

// Wave 1 (#251) — startup invariant. Mirrors `lib/server/inngest/client.ts`:
// emit a loud, structured error log line at module load when running under
// `NODE_ENV=production` with the token unset or empty. Vercel surfaces the
// log to the function dashboard so an oncall sees the misconfiguration BEFORE
// the first user hits the upload endpoint and gets a 503. The runtime path
// in `uploadPhoto` still throws `BlobNotConfiguredError`, so this is purely
// a faster-feedback signal — the route stays safe either way.
//
// Non-throwing in non-prod (dev / preview / test) so the suite runs without
// a Blob token and `vercel build`'s prerender phase doesn't crash.
if (process.env.NODE_ENV === "production") {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || token.trim() === "") {
    logger.error(
      "[photos] BLOB_READ_WRITE_TOKEN is missing or empty — every /api/photos/upload " +
        "request will fail with 503 BLOB_NOT_CONFIGURED until this is set in Vercel " +
        "Project Settings → Environment Variables (Production scope). See " +
        "docs/ops/wave1-env-sync-checklist.md §2a for the exact `vercel env add` command.",
    );
  }
}

export { uploadPhoto } from "./upload-photo";
export {
  BlobNetworkError,
  BlobNotConfiguredError,
  BlobQuotaExceededError,
  BlobTokenMissingError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
  MissingFileError,
  BLOB_NETWORK_ERROR,
  BLOB_NOT_CONFIGURED,
  BLOB_QUOTA_EXCEEDED,
  BLOB_UPLOAD_FAILED,
  FILE_TOO_LARGE,
  INVALID_FILE_TYPE,
  MISSING_FILE,
} from "./errors";
