/**
 * @vitest-environment node
 *
 * Wave 1 / Issue #251 — `/api/photos/upload` route MUST return typed-error
 * envelopes (`{ error, message }`) on every failure path, never a bare 500
 * BLOB_UPLOAD_FAILED with no body context.
 *
 * The pre-#251 route delegated all error mapping to `mapApiDomainError`,
 * which still mapped `BlobUploadFailedError` → bare `{ error: "BLOB_UPLOAD_FAILED" }`
 * with status 500. The user-visible symptom: a logger photo-upload during a
 * stress test returned 500 with no `message`, breaking the toast surface.
 *
 * The fix maps every typed photo error onto a 4xx/5xx response with both
 * `error` (machine code) and `message` (human-readable) populated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { uploadPhotoMock, getFarmContextMock } = vi.hoisted(() => ({
  uploadPhotoMock: vi.fn(),
  getFarmContextMock: vi.fn(),
}));

vi.mock("@/lib/domain/photos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/domain/photos")>(
    "@/lib/domain/photos",
  );
  return {
    ...actual,
    uploadPhoto: uploadPhotoMock,
  };
});

vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: getFarmContextMock,
}));

import { POST } from "@/app/api/photos/upload/route";
import {
  BlobNetworkError,
  BlobNotConfiguredError,
  BlobQuotaExceededError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
} from "@/lib/domain/photos/errors";

beforeEach(() => {
  uploadPhotoMock.mockReset();
  getFarmContextMock.mockReset();
  getFarmContextMock.mockResolvedValue({
    prisma: {},
    role: "LOGGER",
    slug: "trio-b",
    session: { user: { id: "user-1", email: "logger@farm.co.za" } },
  });
});

function makeMultipartRequest(file?: File): NextRequest {
  const fd = new FormData();
  if (file) fd.append("file", file);
  return new NextRequest("https://farmtrack.app/api/photos/upload", {
    method: "POST",
    body: fd as unknown as BodyInit,
  });
}

function makeFile(opts: { name: string; type: string; size: number }): File {
  const blob = new Blob([new Uint8Array(opts.size)], { type: opts.type });
  return new File([blob], opts.name, { type: opts.type });
}

describe("POST /api/photos/upload — typed error envelopes", () => {
  it("returns 200 + { url } on happy-path upload", async () => {
    uploadPhotoMock.mockResolvedValue({
      url: "https://blob.example.com/ok.jpg",
    });
    const file = makeFile({ name: "ok.jpg", type: "image/jpeg", size: 100 });

    const res = await POST(makeMultipartRequest(file), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      url: "https://blob.example.com/ok.jpg",
    });
  });

  it("returns 400 MISSING_FILE with message when no file part is supplied", async () => {
    const res = await POST(makeMultipartRequest(undefined), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("MISSING_FILE");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("returns 413 FILE_TOO_LARGE with message when uploadPhoto throws FileTooLargeError", async () => {
    uploadPhotoMock.mockRejectedValue(new FileTooLargeError(5 * 1024 * 1024));
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    const res = await POST(makeMultipartRequest(file), { params: Promise.resolve({}) });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("FILE_TOO_LARGE");
    expect(typeof body.message).toBe("string");
    expect(body.message).toMatch(/10 ?MB|too large|max/i);
  });

  it("returns 415 INVALID_FILE_TYPE with message when uploadPhoto throws InvalidFileTypeError", async () => {
    uploadPhotoMock.mockRejectedValue(
      new InvalidFileTypeError("application/pdf"),
    );
    const file = makeFile({
      name: "bad.pdf",
      type: "application/pdf",
      size: 100,
    });

    const res = await POST(makeMultipartRequest(file), { params: Promise.resolve({}) });

    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe("INVALID_FILE_TYPE");
    expect(typeof body.message).toBe("string");
  });

  it("returns 503 BLOB_NOT_CONFIGURED with operator-actionable message", async () => {
    uploadPhotoMock.mockRejectedValue(new BlobNotConfiguredError());
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    const res = await POST(makeMultipartRequest(file), { params: Promise.resolve({}) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("BLOB_NOT_CONFIGURED");
    expect(typeof body.message).toBe("string");
  });

  it("returns 503 BLOB_QUOTA_EXCEEDED with message on quota failure", async () => {
    uploadPhotoMock.mockRejectedValue(new BlobQuotaExceededError());
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    const res = await POST(makeMultipartRequest(file), { params: Promise.resolve({}) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("BLOB_QUOTA_EXCEEDED");
    expect(typeof body.message).toBe("string");
  });

  it("returns 503 BLOB_NETWORK_ERROR with retry-friendly message on transient failure", async () => {
    uploadPhotoMock.mockRejectedValue(new BlobNetworkError(new Error("fetch failed")));
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    const res = await POST(makeMultipartRequest(file), { params: Promise.resolve({}) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("BLOB_NETWORK_ERROR");
    expect(typeof body.message).toBe("string");
    expect(body.message).toMatch(/network|connection|retry|try again/i);
  });

  it("returns 502 BLOB_UPLOAD_FAILED (NOT bare 500) with message for unclassified failures", async () => {
    uploadPhotoMock.mockRejectedValue(new BlobUploadFailedError(new Error("unknown")));
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    const res = await POST(makeMultipartRequest(file), { params: Promise.resolve({}) });

    // Issue #251 acceptance criterion: failure must be 4xx OR explicit 5xx
    // with `{error, message}` — never the legacy bare 500.
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("BLOB_UPLOAD_FAILED");
    expect(typeof body.message).toBe("string");
  });

  it("returns 401 AUTH_REQUIRED when no session (delegates to tenantWrite envelope)", async () => {
    getFarmContextMock.mockResolvedValue(null);
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    const res = await POST(makeMultipartRequest(file), { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("AUTH_REQUIRED");
  });
});
