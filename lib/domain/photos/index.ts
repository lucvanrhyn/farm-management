/**
 * Wave F (#163) — public surface of the photos domain ops.
 *
 * Pure infrastructure surface — no Prisma. The transport adapters wrap
 * `tenantWrite` around `uploadPhoto`; typed errors map onto the wire
 * envelope via `mapApiDomainError` at `lib/server/api-errors.ts`.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-163-comms-surfaces.md`.
 */
export { uploadPhoto } from "./upload-photo";
export {
  BlobNotConfiguredError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
  MissingFileError,
  BLOB_NOT_CONFIGURED,
  BLOB_UPLOAD_FAILED,
  FILE_TOO_LARGE,
  INVALID_FILE_TYPE,
  MISSING_FILE,
} from "./errors";
