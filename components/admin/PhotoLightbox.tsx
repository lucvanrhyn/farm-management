'use client';

/**
 * components/admin/PhotoLightbox.tsx
 *
 * Wave 5a / issue #264 — full-size photo viewer for the admin animal
 * detail Photos tab. Native overlay (no library — keeps the bundle slim
 * per the audit-bundle gate). Closes on:
 *   - clicking the close button
 *   - pressing Escape
 *   - clicking the dimmed backdrop outside the image
 *
 * Renders only when `open=true` so the test can assert the lightbox is
 * absent before the user opens it.
 *
 * Accessibility:
 *   - `role="dialog"` + `aria-modal="true"` so AT users get the modal
 *     semantics; the close button carries an explicit `aria-label`.
 */
import { useEffect } from 'react';

interface Props {
  open: boolean;
  url: string | null;
  alt?: string;
  onClose: () => void;
}

export function PhotoLightbox({ open, url, alt, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !url) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <button
        type="button"
        aria-label="Close photo"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#FAFAF8',
          border: 'none',
          borderRadius: '999px',
          width: '40px',
          height: '40px',
          fontSize: '20px',
          cursor: 'pointer',
        }}
      >
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt ?? 'Animal photo'}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          borderRadius: '0.5rem',
        }}
      />
    </div>
  );
}
