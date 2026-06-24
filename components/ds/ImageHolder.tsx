'use client';

/**
 * components/ds/ImageHolder.tsx
 *
 * Reusable single-image holder primitive (design-system kit).
 *
 * Behaviour (the app-wide image-holder contract):
 *   - EMPTY  (src == null): a dashed-border box mirroring the HomePortal
 *     `ImageSlot` look, with a centered "+ Add image" affordance. Click →
 *     opens the hidden file picker.
 *   - POPULATED (src set): the image renders inside a button → clicking it
 *     opens the full-screen zoom (`PhotoLightbox`, reused AS-IS). A small
 *     "Change image" overlay button (bottom-right) re-opens the picker.
 *
 * Composition over rebuild:
 *   - Zoom layer = `@/components/admin/PhotoLightbox` (no changes; this
 *     component just drives its open/url/onClose).
 *   - Client-side validation (size ≤ 10 MB + MIME allow-list) mirrors the
 *     server contract in `lib/domain/photos/upload-photo.ts` and the
 *     `PhotoCapture` widget — constants are identical so a client-side
 *     accept always means a server-side accept.
 *   - Compression reuses `@/lib/compress-image` (graceful fallback to the
 *     original file on compression failure).
 *
 * Offline-aware (lightweight): consumes `useOffline()` to disable the
 * Add/Change affordances and surface a "reconnect to upload" hint when the
 * device is offline. It does NOT build a new pending-store — the existing
 * `pending_photos` queue is observation-bound and is the wrong fit for a
 * standalone primary image, so this holder is online-first (the accepted
 * pattern for admin-side uploads, see `AnimalPhotosTab`).
 *
 * Tier-agnostic by design — no `useTier`/`PAID_TIERS` reference. If a caller
 * plugs this into a premium-only surface, the CALLER gates the page.
 *
 * Theming: `--ft-*` tokens only.
 */
import { useRef, useState } from 'react';
import { PhotoLightbox } from '@/components/admin/PhotoLightbox';
import { Icon } from './icons';
import { useOffline } from '@/components/logger/OfflineProvider';

// Mirrors lib/domain/photos/upload-photo.ts + components/logger/PhotoCapture.tsx.
// Keep identical: a client-side accept must always be a server-side accept.
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;

export interface ImageHolderProps {
  /** Current image URL; `null` = empty state. */
  src: string | null;
  /** Required for a11y (alt text + lightbox label). */
  alt: string;
  /** Called for BOTH add & change with the chosen (validated, compressed) file. */
  onUpload: (file: File) => Promise<void>;
  /** Empty-state copy. Default "Add image". */
  label?: string;
  /** Change-button copy. Default "Change image". */
  changeLabel?: string;
  /** Holder height in px. Default 200. */
  height?: number;
  /** Border radius in px. Default reads `var(--ft-r)` (12px fallback). */
  radius?: number;
  /** Hard-disable the picker (e.g. caller-driven). Offline disables it too. */
  disabled?: boolean;
  /** Show an "Uploading…" overlay + dim. Caller sets this around `onUpload`. */
  busy?: boolean;
}

interface HolderError {
  code: 'FILE_TOO_LARGE' | 'INVALID_FILE_TYPE' | 'UPLOAD_FAILED';
  message: string;
}

export function ImageHolder({
  src,
  alt,
  onUpload,
  label = 'Add image',
  changeLabel = 'Change image',
  height = 200,
  radius,
  disabled = false,
  busy = false,
}: ImageHolderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [error, setError] = useState<HolderError | null>(null);
  // Tracks the exact URL that failed to load (not a boolean) so that when the
  // caller swaps `src` to a new image the holder auto-retries the new URL — no
  // effect needed, and a still-broken replacement re-fails on its own onError.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // A dead/unreachable image URL degrades to the empty "Add image" affordance
  // instead of the browser's broken-image glyph.
  const imageBroken = src != null && failedSrc === src;

  const { isOnline } = useOffline();
  const offline = !isOnline;
  // Picker is unavailable while busy, hard-disabled, or offline.
  const pickerDisabled = disabled || busy || offline;
  const cornerRadius = radius != null ? `${radius}px` : 'var(--ft-r)';

  function openPicker() {
    if (pickerDisabled) return;
    inputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file again re-fires onChange.
    e.target.value = '';
    if (!file) return;

    setError(null);

    if (file.size > MAX_FILE_SIZE) {
      setError({ code: 'FILE_TOO_LARGE', message: 'Photo too large — max 10 MB.' });
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
      setError({
        code: 'INVALID_FILE_TYPE',
        message: `Invalid file type: ${file.type || 'unknown'}. Use JPEG, PNG, WebP, or HEIC.`,
      });
      return;
    }

    try {
      // Compress before upload; the caller's onUpload owns the network call.
      // On compression failure we still hand over the original file — the
      // validation gates above already guaranteed size + MIME are OK.
      let toUpload: File = file;
      try {
        const { compressImage } = await import('@/lib/compress-image');
        const compressed = await compressImage(file);
        // compressImage returns a Blob; wrap as a File so the multipart field
        // keeps a sensible filename for the blob key (upload-photo.ts).
        toUpload = new File([compressed], file.name, {
          type: compressed.type || file.type,
        });
      } catch {
        toUpload = file;
      }
      await onUpload(toUpload);
    } catch (err) {
      setError({
        code: 'UPLOAD_FAILED',
        message: err instanceof Error ? err.message : 'Upload failed.',
      });
    }
  }

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic"
      capture="environment"
      onChange={handleFileChange}
      disabled={pickerDisabled}
      className="hidden"
      aria-label={src ? changeLabel : label}
    />
  );

  const alertBlock = error ? (
    <p
      role="alert"
      className="mt-2 text-sm font-medium"
      style={{ color: 'var(--ft-poor)' }}
    >
      {error.message}
    </p>
  ) : null;

  const offlineHint = offline ? (
    <p className="mt-2 text-xs" style={{ color: 'var(--ft-subtle)' }}>
      Offline — reconnect to upload.
    </p>
  ) : null;

  // ── EMPTY STATE ──────────────────────────────────────────────────────────
  // Also the fallback when a populated `src` fails to load (broken/deleted blob).
  if (!src || imageBroken) {
    return (
      <div>
        {hiddenInput}
        <button
          type="button"
          onClick={openPicker}
          disabled={pickerDisabled}
          aria-label={label}
          style={{
            width: '100%',
            height,
            borderRadius: cornerRadius,
            background: 'var(--ft-surface)',
            border: '1.5px dashed var(--ft-border)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--ft-subtle)',
            cursor: pickerDisabled ? 'not-allowed' : 'pointer',
            opacity: pickerDisabled ? 0.6 : 1,
          }}
        >
          <Icon.image size={Math.min(34, Math.round(height * 0.32))} />
          <span
            className="inline-flex items-center gap-1 text-sm font-semibold"
            style={{ color: 'var(--ft-muted)' }}
          >
            <Icon.plus size={16} />
            {busy ? 'Uploading…' : label}
          </span>
        </button>
        {offlineHint}
        {alertBlock}
      </div>
    );
  }

  // ── POPULATED STATE ──────────────────────────────────────────────────────
  return (
    <div>
      {hiddenInput}
      <div style={{ position: 'relative', width: '100%', height }}>
        <button
          type="button"
          onClick={() => setZoomOpen(true)}
          aria-label={`Zoom ${alt}`}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: cornerRadius,
            overflow: 'hidden',
            border: '1px solid var(--ft-border)',
            background: 'var(--ft-bg)',
            padding: 0,
            cursor: 'pointer',
            display: 'block',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onError={() => setFailedSrc(src)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </button>

        <button
          type="button"
          onClick={openPicker}
          disabled={pickerDisabled}
          aria-label={changeLabel}
          className="inline-flex items-center gap-1 text-xs font-semibold"
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            padding: '6px 10px',
            borderRadius: 'var(--ft-r-sm)',
            background: 'var(--ft-surface)',
            border: '1px solid var(--ft-border)',
            color: 'var(--ft-text)',
            cursor: pickerDisabled ? 'not-allowed' : 'pointer',
            opacity: pickerDisabled ? 0.6 : 1,
            boxShadow: 'var(--ft-shadow)',
          }}
        >
          <Icon.edit size={14} />
          {busy ? 'Uploading…' : changeLabel}
        </button>
      </div>

      {offlineHint}
      {alertBlock}

      <PhotoLightbox
        open={zoomOpen}
        url={src}
        alt={alt}
        onClose={() => setZoomOpen(false)}
      />
    </div>
  );
}
