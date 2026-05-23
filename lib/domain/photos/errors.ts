/**
 * Wave F (#163) — domain-layer typed errors for `lib/domain/photos/*`.
 * Wave 1 (#251) — extended with `BlobTokenMissingError` (alias),
 * `BlobQuotaExceededError`, `BlobNetworkError`. Each error wraps a
 * SCREAMING_SNAKE wire code mapped via the route handler.
 *
 * Wire shape:
 *   503 BLOB_NOT_CONFIGURED   — token unset (legacy code, also raised as
 *                                BlobTokenMissingError for new callers).
 *   400 MISSING_FILE          — multipart had no file part.
 *   413 FILE_TOO_LARGE        — exceeded the size cap.
 *   415 INVALID_FILE_TYPE     — disallowed MIME.
 *   503 BLOB_QUOTA_EXCEEDED   — Vercel Blob rate-limited or store suspended.
 *   503 BLOB_NETWORK_ERROR    — transient network/availability failure
 *                                (raised after one in-process retry).
 *   502 BLOB_UPLOAD_FAILED    — unclassified put() failure (auth, etc.).
 */

export const BLOB_NOT_CONFIGURED = "BLOB_NOT_CONFIGURED" as const;
export const MISSING_FILE = "MISSING_FILE" as const;
export const FILE_TOO_LARGE = "FILE_TOO_LARGE" as const;
export const INVALID_FILE_TYPE = "INVALID_FILE_TYPE" as const;
export const BLOB_UPLOAD_FAILED = "BLOB_UPLOAD_FAILED" as const;
export const BLOB_QUOTA_EXCEEDED = "BLOB_QUOTA_EXCEEDED" as const;
export const BLOB_NETWORK_ERROR = "BLOB_NETWORK_ERROR" as const;

/**
 * `BLOB_READ_WRITE_TOKEN` env var is unset — Vercel Blob client cannot be
 * initialised. Wire: 503 `{ error: "BLOB_NOT_CONFIGURED" }`.
 *
 * `BlobTokenMissingError` (Wave 1 / #251) is the canonical alias new
 * callers should `instanceof`-check; `BlobNotConfiguredError` is kept as
 * the throw class so the wire code stays `BLOB_NOT_CONFIGURED` and offline
 * clients that hard-coded the legacy code don't break. Both names refer to
 * the same class.
 */
export class BlobNotConfiguredError extends Error {
  readonly code = BLOB_NOT_CONFIGURED;
  constructor() {
    super("Photo uploads are temporarily unavailable. The operator has been notified.");
    this.name = "BlobNotConfiguredError";
  }
}

/** Wave 1 / #251 — alias for `BlobNotConfiguredError`. */
export const BlobTokenMissingError = BlobNotConfiguredError;
export type BlobTokenMissingError = BlobNotConfiguredError;

/**
 * Multipart form had no `file` part, or the part was not a `File`.
 * Wire: 400 `{ error: "MISSING_FILE" }`.
 */
export class MissingFileError extends Error {
  readonly code = MISSING_FILE;
  constructor() {
    super("No photo was attached to the upload request.");
    this.name = "MissingFileError";
  }
}

/**
 * Uploaded file exceeded the 10 MB hard cap (Wave 1 / #251 raised the cap
 * from 4 MB to 10 MB to match modern phone-camera output without forcing
 * client-side downscaling). Wire: 413 `{ error: "FILE_TOO_LARGE" }`.
 */
export class FileTooLargeError extends Error {
  readonly code = FILE_TOO_LARGE;
  readonly size: number;
  constructor(size: number) {
    super("Photo too large — max 10 MB.");
    this.name = "FileTooLargeError";
    this.size = size;
  }
}

/**
 * Uploaded file MIME type is not in the allow-list (image/jpeg, image/png,
 * image/webp, image/heic). Wire: 415 `{ error: "INVALID_FILE_TYPE" }`.
 */
export class InvalidFileTypeError extends Error {
  readonly code = INVALID_FILE_TYPE;
  readonly type: string;
  constructor(type: string) {
    super(`Invalid file type: ${type || "unknown"}. Use JPEG, PNG, WebP, or HEIC.`);
    this.name = "InvalidFileTypeError";
    this.type = type;
  }
}

/**
 * Vercel Blob signalled that the store is rate-limited or suspended (e.g.
 * monthly quota exhausted). The caller should NOT retry in-process; the
 * fix requires operator action (raise the quota, replace the token).
 * Wire: 503 `{ error: "BLOB_QUOTA_EXCEEDED" }`.
 */
export class BlobQuotaExceededError extends Error {
  readonly code = BLOB_QUOTA_EXCEEDED;
  constructor(cause?: unknown) {
    super("Photo storage quota exceeded — the operator has been notified.");
    this.name = "BlobQuotaExceededError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Transient network or availability failure from the Vercel Blob service
 * — raised AFTER `uploadPhoto` has already retried the `put()` once. The
 * caller (logger UI / sync manager) should leave the photo in the queue
 * and retry on the next sync cycle. Wire: 503
 * `{ error: "BLOB_NETWORK_ERROR" }`.
 */
export class BlobNetworkError extends Error {
  readonly code = BLOB_NETWORK_ERROR;
  constructor(cause?: unknown) {
    super("Connection lost — tap to retry the photo upload.");
    this.name = "BlobNetworkError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Vercel Blob `put()` threw an error we don't otherwise classify (auth,
 * pathname mismatch, unknown). Wire: 502 `{ error: "BLOB_UPLOAD_FAILED" }`.
 *
 * Pre-#251 this was a 500 catch-all for ALL `put()` rejections; #251
 * pulled out the network and quota sub-classes so the route can return
 * actionable messages. Anything left here is genuinely unclassified.
 */
export class BlobUploadFailedError extends Error {
  readonly code = BLOB_UPLOAD_FAILED;
  constructor(cause?: unknown) {
    super(
      cause instanceof Error
        ? `Photo upload failed (${cause.message}). The operator has been notified.`
        : "Photo upload failed. The operator has been notified.",
    );
    this.name = "BlobUploadFailedError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}
