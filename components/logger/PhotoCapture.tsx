'use client';

import { useRef, useState } from 'react';
import { compressImage } from '@/lib/compress-image';

interface Props {
  onPhotoCapture: (blob: Blob) => void;
  existingPhotoUrl?: string;
}

export function PhotoCapture({ onPhotoCapture, existingPhotoUrl }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingPhotoUrl ?? null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

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
      // Silently ignore compression failures — use original
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
    </div>
  );
}
