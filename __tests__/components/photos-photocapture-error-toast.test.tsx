// @vitest-environment jsdom
/**
 * Wave 1 / Issue #251 — PhotoCapture must surface the typed photo errors
 * to the logger user as actionable inline messages BEFORE the blob is
 * handed off to the offline sync queue. The pre-#251 component silently
 * swallowed compression failures and validated nothing — meaning a 5 MB
 * photo or a wrong MIME type only surfaced as a 4xx from the server hours
 * later (or never, if the user closed the app between capture and sync).
 *
 * Public contract:
 *   - `onPhotoCapture(blob)` fires only on a valid file.
 *   - `onError({ code, message })` fires for every reject path (size, type).
 *   - The component renders an inline error message (`role="alert"`) when
 *     a validation error trips, so the user has somewhere to read it even
 *     if the parent doesn't wire `onError`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { PhotoCapture } from "@/components/logger/PhotoCapture";

// Stub compress-image so the test doesn't need a real canvas. The real
// behaviour is exercised by the e2e suite; here we only care about the
// validation gate sitting in front of compression.
vi.mock("@/lib/compress-image", () => ({
  compressImage: vi.fn(async (file: File | Blob) => file),
}));

function makeFile(opts: { name: string; type: string; size: number }): File {
  const blob = new Blob([new Uint8Array(opts.size)], { type: opts.type });
  return new File([blob], opts.name, { type: opts.type });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PhotoCapture — client-side validation toast", () => {
  it("rejects a file larger than 10 MB before it reaches onPhotoCapture", async () => {
    const onPhotoCapture = vi.fn();
    const onError = vi.fn();

    render(
      <PhotoCapture
        onPhotoCapture={onPhotoCapture}
        onError={onError}
      />,
    );

    const input = screen.getByLabelText(/capture photo/i) as HTMLInputElement;
    const huge = makeFile({
      name: "huge.jpg",
      type: "image/jpeg",
      size: 10 * 1024 * 1024 + 1,
    });

    Object.defineProperty(input, "files", { value: [huge], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onPhotoCapture).not.toHaveBeenCalled();

    const errorPayload = onError.mock.calls[0][0];
    expect(errorPayload.code).toBe("FILE_TOO_LARGE");
    expect(typeof errorPayload.message).toBe("string");
    expect(errorPayload.message).toMatch(/10 ?MB|too large|max/i);
  });

  it("rejects a non-image file before it reaches onPhotoCapture", async () => {
    const onPhotoCapture = vi.fn();
    const onError = vi.fn();

    render(
      <PhotoCapture
        onPhotoCapture={onPhotoCapture}
        onError={onError}
      />,
    );

    const input = screen.getByLabelText(/capture photo/i) as HTMLInputElement;
    const pdf = makeFile({
      name: "doc.pdf",
      type: "application/pdf",
      size: 100,
    });

    Object.defineProperty(input, "files", { value: [pdf], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onPhotoCapture).not.toHaveBeenCalled();

    const errorPayload = onError.mock.calls[0][0];
    expect(errorPayload.code).toBe("INVALID_FILE_TYPE");
  });

  it("renders an inline alert when a validation error trips, even with no onError prop", async () => {
    render(<PhotoCapture onPhotoCapture={vi.fn()} />);

    const input = screen.getByLabelText(/capture photo/i) as HTMLInputElement;
    const huge = makeFile({
      name: "huge.jpg",
      type: "image/jpeg",
      size: 10 * 1024 * 1024 + 1,
    });

    Object.defineProperty(input, "files", { value: [huge], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/10 ?MB|too large|max/i);
    });
  });

  it("clears the inline alert once a valid photo is selected", async () => {
    render(<PhotoCapture onPhotoCapture={vi.fn()} />);

    const input = screen.getByLabelText(/capture photo/i) as HTMLInputElement;

    // First, trip the alert with an oversize file.
    const huge = makeFile({
      name: "huge.jpg",
      type: "image/jpeg",
      size: 10 * 1024 * 1024 + 1,
    });
    Object.defineProperty(input, "files", { value: [huge], configurable: true });
    fireEvent.change(input);
    await waitFor(() => screen.getByRole("alert"));

    // Then, drop in a valid file and confirm the alert clears.
    const ok = makeFile({ name: "ok.jpg", type: "image/jpeg", size: 100 });
    Object.defineProperty(input, "files", { value: [ok], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("accepts a 2 MB JPEG and forwards the blob to onPhotoCapture", async () => {
    const onPhotoCapture = vi.fn();
    const onError = vi.fn();

    render(
      <PhotoCapture
        onPhotoCapture={onPhotoCapture}
        onError={onError}
      />,
    );

    const input = screen.getByLabelText(/capture photo/i) as HTMLInputElement;
    const realistic = makeFile({
      name: "shot.jpg",
      type: "image/jpeg",
      size: 2 * 1024 * 1024,
    });

    Object.defineProperty(input, "files", { value: [realistic], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(onPhotoCapture).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
  });
});
