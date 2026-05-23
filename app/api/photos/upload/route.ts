/**
 * Wave F (#163) — `/api/photos/upload` POST migrated onto `tenantWrite`.
 * Wave 1 (#251) — wraps the typed photo errors into a `{ error, message }`
 * envelope per failure path so the logger UI can surface an actionable
 * toast (per acceptance criterion: "no bare 500 BLOB_UPLOAD_FAILED").
 *
 * Photos use multipart form-data, NOT JSON — the adapter's `parseBody`
 * helper detects the content-type and skips the JSON parse, leaving body
 * as `undefined` and the raw `req` available for `req.formData()`. No
 * `schema` is supplied for the same reason.
 *
 * The route stays role-agnostic: any authenticated tenant member (LOGGER /
 * VIEWER / ADMIN) may upload photos — the pre-Wave-F route had no role
 * check, only the auth gate. `tenantWrite` preserves that contract.
 */
import { NextResponse } from "next/server";

import { tenantWrite } from "@/lib/server/route";
import {
  BlobNetworkError,
  BlobNotConfiguredError,
  BlobQuotaExceededError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
  MissingFileError,
  uploadPhoto,
} from "@/lib/domain/photos";

/**
 * Wire-shape mapping table — each typed error class lands on exactly one
 * status + code pair, with the user-facing message coming from the error
 * itself (`err.message`) so there's a single source of truth for the
 * copy. Anything not in this table re-throws so `tenantWrite`'s default
 * 500 path catches it.
 *
 * Status choices:
 *   - 4xx for errors the user can act on (file too big, wrong type, missing).
 *   - 503 for transient or operator-action errors (network blip, quota,
 *     misconfigured token) so monitoring and downstream sync queues can
 *     classify them as "retry later" without parsing the body.
 *   - 502 for unclassified upstream failures (was 500 pre-#251).
 */
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

export const POST = tenantWrite({
  handle: async (ctx, _body, req) => {
    try {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new MissingFileError();
      }
      const result = await uploadPhoto(ctx.slug, file);
      return NextResponse.json(result);
    } catch (err) {
      // Map every typed photo error to the message-bearing envelope here.
      // We don't fall back to `tenantWrite`'s `mapApiDomainError` because
      // that path emits `{ error: CODE }` only — the logger UI needs the
      // human `message` to surface a useful toast (issue #251).
      const mapped = mapPhotoError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
});
