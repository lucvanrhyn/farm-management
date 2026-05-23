/**
 * @vitest-environment node
 *
 * Wave 1 / Issue #251 — PhotoUploadGateway hardening.
 *
 * Locks the new typed error contract: in addition to the pre-Wave-F errors
 * (`BlobNotConfiguredError`, `MissingFileError`, `FileTooLargeError`,
 * `InvalidFileTypeError`, `BlobUploadFailedError`), the gateway now also
 * surfaces `BlobTokenMissingError`, `BlobQuotaExceededError`, and
 * `BlobNetworkError` — and **retries once on a network error** before
 * surfacing it.
 *
 * Every failure path must also emit a structured Sentry-style breadcrumb
 * via the logger so the prod log stream surfaces enough context to
 * root-cause without needing a repro.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

const mockPut = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@vercel/blob", async () => {
  // Re-export real error classes so `instanceof` checks inside `upload-photo`
  // continue to work; only `put` is faked.
  const actual = await vi.importActual<typeof import("@vercel/blob")>(
    "@vercel/blob",
  );
  return {
    ...actual,
    put: mockPut,
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mockLoggerError,
    warn: mockLoggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  BlobAccessError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
  BlobStoreSuspendedError,
} from "@vercel/blob";

import { uploadPhoto } from "@/lib/domain/photos/upload-photo";
import {
  BlobNetworkError,
  BlobNotConfiguredError,
  BlobQuotaExceededError,
  BlobTokenMissingError,
  BlobUploadFailedError,
  FileTooLargeError,
} from "@/lib/domain/photos/errors";

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

function makeFile(opts: { name: string; type: string; size: number }): File {
  const blob = new Blob([new Uint8Array(opts.size)], { type: opts.type });
  return new File([blob], opts.name, { type: opts.type });
}

beforeEach(() => {
  mockPut.mockReset();
  mockLoggerError.mockReset();
  mockLoggerWarn.mockReset();
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  }
});

describe("PhotoUploadGateway — typed errors", () => {
  it("BlobTokenMissingError is the canonical alias for the missing-token failure path", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    let caught: unknown;
    try {
      await uploadPhoto("trio-b", file);
    } catch (err) {
      caught = err;
    }

    // Both the legacy and the issue-#251-mandated alias must match —
    // the production wire code stays `BLOB_NOT_CONFIGURED` so old clients
    // don't break, but new code can `instanceof BlobTokenMissingError`.
    expect(caught).toBeInstanceOf(BlobNotConfiguredError);
    expect(caught).toBeInstanceOf(BlobTokenMissingError);
  });

  it("BlobQuotaExceededError fires when @vercel/blob throws BlobServiceRateLimited", async () => {
    mockPut.mockRejectedValue(
      new BlobServiceRateLimited(60),
    );
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobQuotaExceededError,
    );
  });

  it("BlobQuotaExceededError fires when @vercel/blob throws BlobStoreSuspendedError", async () => {
    mockPut.mockRejectedValue(new BlobStoreSuspendedError());
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobQuotaExceededError,
    );
  });

  it("BlobNetworkError fires when @vercel/blob throws BlobServiceNotAvailable (after retry)", async () => {
    mockPut.mockRejectedValue(new BlobServiceNotAvailable());
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobNetworkError,
    );
  });

  it("BlobNetworkError fires for a generic fetch network error (after retry)", async () => {
    mockPut.mockRejectedValue(new TypeError("fetch failed"));
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobNetworkError,
    );
  });

  it("BlobUploadFailedError remains the catch-all for unclassified put() rejects (e.g. BlobAccessError)", async () => {
    mockPut.mockRejectedValue(new BlobAccessError());
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    let caught: unknown;
    try {
      await uploadPhoto("trio-b", file);
    } catch (err) {
      caught = err;
    }

    // Specific catch-all — NOT a network or quota error.
    expect(caught).toBeInstanceOf(BlobUploadFailedError);
    expect(caught).not.toBeInstanceOf(BlobNetworkError);
    expect(caught).not.toBeInstanceOf(BlobQuotaExceededError);
  });
});

describe("PhotoUploadGateway — retry-once-on-network-error", () => {
  it("retries put() once on transient network failure, then succeeds", async () => {
    mockPut
      .mockRejectedValueOnce(new BlobServiceNotAvailable())
      .mockResolvedValueOnce({
        url: "https://blob.example.com/ok.jpg",
      });
    const file = makeFile({ name: "ok.jpg", type: "image/jpeg", size: 100 });

    const result = await uploadPhoto("trio-b", file);

    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ url: "https://blob.example.com/ok.jpg" });
  });

  it("retries put() at most once before throwing BlobNetworkError", async () => {
    mockPut.mockRejectedValue(new BlobServiceNotAvailable());
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobNetworkError,
    );
    expect(mockPut).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on quota errors (rate limit is not retriable in-process)", async () => {
    mockPut.mockRejectedValue(new BlobServiceRateLimited(60));
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobQuotaExceededError,
    );
    expect(mockPut).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on access errors (auth misconfig won't fix itself)", async () => {
    mockPut.mockRejectedValue(new BlobAccessError());
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobUploadFailedError,
    );
    expect(mockPut).toHaveBeenCalledTimes(1);
  });
});

describe("PhotoUploadGateway — Sentry-style breadcrumbs on failure", () => {
  it("emits a [breadcrumb][photos.upload] log entry on every failure path", async () => {
    mockPut.mockRejectedValue(new BlobServiceNotAvailable());
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 1234 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobNetworkError,
    );

    // The breadcrumb is structured — tenant slug, file size, content type,
    // and the typed error code so a log filter can pivot by failure mode.
    expect(mockLoggerError).toHaveBeenCalled();
    const breadcrumbCalls = mockLoggerError.mock.calls.filter((call) =>
      String(call[0]).includes("[breadcrumb][photos.upload]"),
    );
    expect(breadcrumbCalls.length).toBeGreaterThan(0);
    const [, payload] = breadcrumbCalls[breadcrumbCalls.length - 1];
    expect(payload).toMatchObject({
      slug: "trio-b",
      size: 1234,
      contentType: "image/jpeg",
      code: "BLOB_NETWORK_ERROR",
    });
  });

  it("emits a breadcrumb with the FILE_TOO_LARGE code when the size cap trips", async () => {
    const file = makeFile({
      name: "huge.jpg",
      type: "image/jpeg",
      size: 10 * 1024 * 1024 + 1,
    });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      FileTooLargeError,
    );

    const breadcrumbCalls = mockLoggerError.mock.calls.filter((call) =>
      String(call[0]).includes("[breadcrumb][photos.upload]"),
    );
    expect(breadcrumbCalls.length).toBeGreaterThan(0);
    expect(breadcrumbCalls[breadcrumbCalls.length - 1][1]).toMatchObject({
      slug: "trio-b",
      code: "FILE_TOO_LARGE",
    });
  });

  it("emits a breadcrumb with the BLOB_QUOTA_EXCEEDED code on rate-limit failure", async () => {
    mockPut.mockRejectedValue(new BlobServiceRateLimited(60));
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobQuotaExceededError,
    );

    const breadcrumbCalls = mockLoggerError.mock.calls.filter((call) =>
      String(call[0]).includes("[breadcrumb][photos.upload]"),
    );
    expect(breadcrumbCalls[breadcrumbCalls.length - 1][1]).toMatchObject({
      slug: "trio-b",
      code: "BLOB_QUOTA_EXCEEDED",
    });
  });
});
