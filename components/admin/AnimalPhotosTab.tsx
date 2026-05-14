'use client';

/**
 * components/admin/AnimalPhotosTab.tsx
 *
 * Wave 5a / issue #264 — admin animal-detail Photos tab. Aggregates every
 * photo on the animal (across Health, Treatment, Calving, Death, etc.)
 * into a thumbnail grid; tap to open the full-size lightbox.
 *
 * Data shape comes from `lib/server/animal-photos.ts :: getAnimalPhotos`
 * — the parent server component fetches and passes the rows down. The
 * tab itself is a client component because the lightbox + admin upload
 * flow both manage local interactive state.
 *
 * Admin upload flow:
 *   1. PhotoCapture (existing client component, #251) validates size +
 *      MIME locally and surfaces typed `FILE_TOO_LARGE` /
 *      `INVALID_FILE_TYPE` errors via toast.
 *   2. POST multipart to `/api/animals/[id]/photos` — that route uploads
 *      to Vercel Blob via `PhotoUploadGateway` and creates a `camp_check`
 *      observation tied to the animal carrying the new attachmentUrl.
 *      Server-side typed errors (`BLOB_NETWORK_ERROR`, `FILE_TOO_LARGE`,
 *      …) bubble to the `message` field which we surface in the toast.
 *   3. After a successful upload we `router.refresh()` so the new tile
 *      appears immediately.
 *
 * The toast is intentionally minimalist — a single `role="status"` line
 * that mirrors PhotoCapture's `role="alert"` pattern. The audit team's
 * Sonner / radix-toast review for #264 is out of scope; if/when a global
 * toast provider lands, this surface migrates to it.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PhotoLightbox } from './PhotoLightbox';
import type { AnimalPhotoRow } from '@/lib/server/animal-photos';

interface Props {
  farmSlug: string;
  animalId: string;
  photos: AnimalPhotoRow[];
}

const TYPE_LABEL: Record<string, string> = {
  health_issue: 'Health issue',
  treatment: 'Treatment',
  calving: 'Calving',
  death: 'Death',
  camp_check: 'Camp check',
  weighing: 'Weighing',
  body_condition_score: 'Body score',
  insemination: 'Insemination',
  pregnancy_scan: 'Pregnancy scan',
  heat_detection: 'Heat detection',
};

function labelForType(type: string): string {
  return TYPE_LABEL[type] ?? type.replace(/_/g, ' ');
}

interface ToastState {
  kind: 'success' | 'error';
  message: string;
}

export function AnimalPhotosTab({ farmSlug, animalId, photos }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activePhoto, setActivePhoto] = useState<AnimalPhotoRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setToast(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/animals/${animalId}/photos`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        let message = `Upload failed (HTTP ${res.status}).`;
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) message = body.message;
        } catch {
          // Non-JSON body — keep the default HTTP-status message.
        }
        setToast({ kind: 'error', message });
        return;
      }
      setToast({ kind: 'success', message: 'Photo uploaded.' });
      router.refresh();
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? `Upload failed: ${err.message}`
            : 'Upload failed.',
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: '#FFFFFF', border: '1px solid #E0D5C8' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: '#9C8E7A' }}
        >
          Photos ({photos.length})
        </h2>
        <label
          aria-label="Upload photo"
          className="inline-flex items-center gap-1 cursor-pointer text-xs font-semibold px-3 py-1.5 rounded-full"
          style={{
            background: uploading ? '#E0D5C8' : '#1C1815',
            color: '#FAFAF8',
            opacity: uploading ? 0.7 : 1,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
          {uploading ? 'Uploading…' : '+ Upload'}
        </label>
      </div>

      {toast && (
        <p
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className="mb-4 text-xs font-medium px-3 py-2 rounded-lg"
          style={
            toast.kind === 'error'
              ? { background: 'rgba(192,87,76,0.12)', color: '#8B3A3A' }
              : { background: 'rgba(34,139,34,0.12)', color: '#1B5E20' }
          }
        >
          {toast.message}
        </p>
      )}

      {photos.length === 0 ? (
        <p className="text-xs" style={{ color: '#9C8E7A' }}>
          No photos yet — upload one above or capture a photo when logging
          a Health, Treatment, Calving, or Death observation.
        </p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 min-w-0">
              <button
                type="button"
                aria-label={`Open photo from ${labelForType(p.type)}`}
                onClick={() => setActivePhoto(p)}
                className="block w-full rounded-xl overflow-hidden"
                style={{
                  aspectRatio: '1 / 1',
                  border: '1px solid #E0D5C8',
                  background: '#FAFAF8',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.attachmentUrl ?? ''}
                  alt={`${labelForType(p.type)} photo`}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              </button>
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block self-start"
                style={{ background: 'rgba(28,24,21,0.06)', color: '#1C1815' }}
              >
                {labelForType(p.type)}
              </span>
              <Link
                href={`/${farmSlug}/admin/observations?focus=${p.id}`}
                className="text-[11px] underline"
                style={{ color: '#9C8E7A' }}
              >
                {new Date(p.observedAt).toLocaleDateString('en-ZA')}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <PhotoLightbox
        open={activePhoto !== null}
        url={activePhoto?.attachmentUrl ?? null}
        alt={
          activePhoto
            ? `${labelForType(activePhoto.type)} photo from ${new Date(
                activePhoto.observedAt,
              ).toLocaleDateString('en-ZA')}`
            : undefined
        }
        onClose={() => setActivePhoto(null)}
      />
    </div>
  );
}
