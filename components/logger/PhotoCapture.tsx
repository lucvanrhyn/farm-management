'use client';

/**
 * Wave 1 / Issue #251 — PhotoCapture client-side validation.
 *
 * Pre-#251 the component silently swallowed compression failures and
 * validated nothing — meaning a 5 MB photo or a wrong MIME type only
 * surfaced as a 4xx hours later when the offline sync queue tried to
 * push it (or NEVER, if the user closed the app first).
 *
 * #251 hardens the surface so the user gets immediate, actionable
 * feedback the moment they pick the file:
 *   - Reject files > 10 MB with `FILE_TOO_LARGE`.
 *   - Reject non-image MIME types with `INVALID_FILE_TYPE`.
 *   - Render an inline `role="alert"` so screen readers + parents that
 *     don't wire `onError` still surface the failure.
 *   - Forward the typed `{ code, message }` to an optional `onError`
 *     callback so parent forms can dispatch toasts / disable Submit.
 *
 * The size cap and MIME allow-list mirror the server contract in
 * `lib/domain/photos/upload-photo.ts` so a client-side accept always
 * means a server-side accept (no double-rejection round-trip).
 */
import { useRef, useState } from 'react';
import { compressImage } from '@/lib/compress-image';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;

export interface PhotoCaptureError {
  code: 'FILE_TOO_LARGE' | 'INVALID_FILE_TYPE';
  message: string;
}

interface Props {
  onPhotoCapture: (blob: Blob) => void;
  onError?: (err: PhotoCaptureError) => void;
  existingPhotoUrl?: string;
}

export function PhotoCapture({ onPhotoCapture, onError, existingPhotoUrl }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingPhotoUrl ?? null);
  const [error, setError] = useState<PhotoCaptureError | null>(null);

  function emitError(err: PhotoCaptureError) {
    setError(err);
    if (onError) onError(err);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset the alert from a prior pick before validating the new one. If
    // the new file fails, `emitError` will repopulate it; if it succeeds,
    // we want the surface clean.
    setError(null);

    if (file.size > MAX_FILE_SIZE) {
      emitError({
        code: 'FILE_TOO_LARGE',
        message: 'Photo too large — max 10 MB.',
      });
      e.target.value = '';
      return;
    }

    if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
      emitError({
        code: 'INVALID_FILE_TYPE',
        message: `Invalid file type: ${file.type || 'unknown'}. Use JPEG, PNG, WebP, or HEIC.`,
      });
      e.target.value = '';
      return;
    }

    try {
      const compressed = await compressImage(file);
      const objectUrl = URL.createObjectURL(compressed);
      // Revoke the previous preview url if it was locally generated
      if (previewUrl && !existingPhotoUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(objectUrl);
      onPhotoCapture(compressed);
    } catch {
      // Compression failure is non-fatal — fall back to the original blob.
      // The validation gates above already guaranteed size + MIME are OK,
      // so the original is safe to upload as-is.
      const objectUrl = URL.createObjectURL(file);
      if (previewUrl && !existingPhotoUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(objectUrl);
      onPhotoCapture(file);
    }

    // Reset input so the same file can be selected again after retake
    e.target.value = '';
  }

  function handleRetake() {
    if (previewUrl && !existingPhotoUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setError(null);
    inputRef.current?.click();
  }

  return (
    <div>
      <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>
        Photo (optional)
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        aria-label="Capture photo"
      />

      {previewUrl ? (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Captured photo preview"
            className="w-full rounded-xl object-cover"
            style={{ maxHeight: '200px', border: '1px solid rgba(92, 61, 46, 0.5)' }}
          />
          <button
            type="button"
            onClick={handleRetake}
            className="w-full py-3 rounded-xl text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'rgba(44, 21, 8, 0.5)',
              border: '1px solid rgba(92, 61, 46, 0.4)',
              color: '#D2B48C',
            }}
          >
            Retake Photo
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full font-semibold rounded-2xl flex items-center justify-center gap-3 transition-colors active:scale-95"
          style={{
            minHeight: '52px',
            backgroundColor: 'rgba(44, 21, 8, 0.5)',
            border: '1px solid rgba(92, 61, 46, 0.4)',
            color: '#D2B48C',
          }}
        >
          <span className="text-xl">📷</span>
          Take Photo
        </button>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 text-sm font-medium"
          style={{ color: '#F87171' }}
        >
          {error.message}
        </p>
      )}
    </div>
  );
}
