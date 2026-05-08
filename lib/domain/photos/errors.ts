/**
 * Wave F (#163) — domain-layer typed errors for `lib/domain/photos/*`.
 *
 * Each error wraps a SCREAMING_SNAKE wire code mapped via
 * `mapApiDomainError` at `lib/server/api-errors.ts`. Wire shape replaces
 * pre-Wave-F free-text strings:
 *
 *   503 "Photo uploads are not configured…" → 503 BLOB_NOT_CONFIGURED
 *   400 "No file provided"                  → 400 MISSING_FILE
 *   413 "File too large (max 4MB)"          → 413 FILE_TOO_LARGE
 *   415 "Only image files are allowed…"     → 415 INVALID_FILE_TYPE
 *   500 "Photo upload failed…"              → 500 BLOB_UPLOAD_FAILED
 */

export const BLOB_NOT_CONFIGURED = "BLOB_NOT_CONFIGURED" as const;
export const MISSING_FILE = "MISSING_FILE" as const;
export const FILE_TOO_LARGE = "FILE_TOO_LARGE" as const;
export const INVALID_FILE_TYPE = "INVALID_FILE_TYPE" as const;
export const BLOB_UPLOAD_FAILED = "BLOB_UPLOAD_FAILED" as const;

/**
 * `BLOB_READ_WRITE_TOKEN` env var is unset — Vercel Blob client cannot be
 * initialised. Wire: 503 `{ error: "BLOB_NOT_CONFIGURED" }`.
 */
export class BlobNotConfiguredError extends Error {
  readonly code = BLOB_NOT_CONFIGURED;
  constructor() {
    super("Vercel Blob is not configured (BLOB_READ_WRITE_TOKEN unset)");
    this.name = "BlobNotConfiguredError";
  }
}

/**
 * Multipart form had no `file` part, or the part was not a `File`.
 * Wire: 400 `{ error: "MISSING_FILE" }`.
 */
export class MissingFileError extends Error {
  readonly code = MISSING_FILE;
  constructor() {
    super("No file provided in multipart body");
    this.name = "MissingFileError";
  }
}

/**
 * Uploaded file exceeded the 4 MB hard cap. Wire: 413
 * `{ error: "FILE_TOO_LARGE" }`.
 */
export class FileTooLargeError extends Error {
  readonly code = FILE_TOO_LARGE;
  readonly size: number;
  constructor(size: number) {
    super(`File too large (${size} bytes; max 4MB)`);
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
    super(`Invalid file type: ${type}`);
    this.name = "InvalidFileTypeError";
    this.type = type;
  }
}

/**
 * Vercel Blob `put()` threw — usually a transient network or auth failure.
 * Wire: 500 `{ error: "BLOB_UPLOAD_FAILED" }`.
 */
export class BlobUploadFailedError extends Error {
  readonly code = BLOB_UPLOAD_FAILED;
  constructor(cause?: unknown) {
    super(
      cause instanceof Error
        ? `Blob upload failed: ${cause.message}`
        : "Blob upload failed",
    );
    this.name = "BlobUploadFailedError";
  }
}
