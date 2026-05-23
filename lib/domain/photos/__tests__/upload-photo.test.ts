/**
 * @vitest-environment node
 *
 * Wave F (#163) — domain op: `uploadPhoto`.
 *
 * Pure infrastructure op (no Prisma). Validates env, file size, and MIME
 * type, then delegates to Vercel Blob `put()`. All five error branches are
 * typed and surface via `mapApiDomainError`.
 *
 * Blob key format: `farm-photos/{slug}/{ts}-{safeName}` where `safeName`
 * replaces every non-alphanumeric/non-`._-` char with `_`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPut = vi.hoisted(() => vi.fn());

vi.mock("@vercel/blob", async () => {
  // Re-export real error classes so `instanceof` checks inside `upload-photo`
  // continue to work (Wave 1 / #251 added BlobServiceNotAvailable +
  // friends to the import surface). Only `put` is faked.
  const actual = await vi.importActual<typeof import("@vercel/blob")>(
    "@vercel/blob",
  );
  return { ...actual, put: mockPut };
});

import { uploadPhoto } from "../upload-photo";
import {
  BlobNotConfiguredError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
} from "../errors";

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

function makeFile(opts: {
  name: string;
  type: string;
  size: number;
}): File {
  // Construct a File via the global File constructor; Node 22 has it.
  const blob = new Blob([new Uint8Array(opts.size)], { type: opts.type });
  return new File([blob], opts.name, { type: opts.type });
}

describe("uploadPhoto(slug, file)", () => {
  beforeEach(() => {
    mockPut.mockReset();
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    } else {
      process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
    }
  });

  it("throws BlobNotConfiguredError when BLOB_READ_WRITE_TOKEN is unset", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobNotConfiguredError,
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("throws FileTooLargeError when file size exceeds the 10 MB cap (Wave 1 / #251)", async () => {
    const file = makeFile({
      name: "huge.jpg",
      type: "image/jpeg",
      size: 10 * 1024 * 1024 + 1,
    });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      FileTooLargeError,
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("throws InvalidFileTypeError on disallowed MIME type", async () => {
    const file = makeFile({
      name: "doc.pdf",
      type: "application/pdf",
      size: 100,
    });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      InvalidFileTypeError,
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("throws BlobUploadFailedError when @vercel/blob put() rejects", async () => {
    mockPut.mockRejectedValue(new Error("network blip"));
    const file = makeFile({ name: "x.jpg", type: "image/jpeg", size: 100 });

    await expect(uploadPhoto("trio-b", file)).rejects.toBeInstanceOf(
      BlobUploadFailedError,
    );
  });

  it("returns { url } on happy-path upload", async () => {
    mockPut.mockResolvedValue({ url: "https://blob.example.com/f.jpg" });
    const file = makeFile({ name: "f.jpg", type: "image/jpeg", size: 100 });

    const result = await uploadPhoto("trio-b", file);

    expect(result).toEqual({ url: "https://blob.example.com/f.jpg" });
  });

  it("uses key format farm-photos/{slug}/{ts}-{name} on put()", async () => {
    mockPut.mockResolvedValue({ url: "https://blob.example.com/x.jpg" });
    const file = makeFile({ name: "shot.jpeg", type: "image/jpeg", size: 100 });

    await uploadPhoto("trio-b", file);

    expect(mockPut).toHaveBeenCalledTimes(1);
    const [key, body, options] = mockPut.mock.calls[0];
    expect(key).toMatch(/^farm-photos\/trio-b\/\d+-shot\.jpeg$/);
    expect(body).toBe(file);
    expect(options).toEqual({ access: "public" });
  });

  it("sanitizes non-alphanumeric chars in the file name (sp aces, slashes, unicode)", async () => {
    mockPut.mockResolvedValue({ url: "https://blob.example.com/x.jpg" });
    const file = makeFile({
      name: "my photo / 2026.jpg",
      type: "image/jpeg",
      size: 100,
    });

    await uploadPhoto("trio-b", file);

    const [key] = mockPut.mock.calls[0];
    // Non-alphanumeric (and non `._-`) chars are replaced with `_`.
    expect(key).toMatch(/^farm-photos\/trio-b\/\d+-my_photo___2026\.jpg$/);
  });

  it.each([
    ["image/jpeg"],
    ["image/png"],
    ["image/webp"],
    ["image/heic"],
  ])("accepts allowed MIME type %s", async (mime) => {
    mockPut.mockResolvedValue({ url: "https://blob.example.com/ok.bin" });
    const file = makeFile({ name: "ok.bin", type: mime, size: 100 });

    await expect(uploadPhoto("trio-b", file)).resolves.toEqual({
      url: "https://blob.example.com/ok.bin",
    });
  });
});
