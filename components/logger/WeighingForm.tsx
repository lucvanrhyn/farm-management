"use client";

import { useState } from "react";
import { PhotoCapture } from "@/components/logger/PhotoCapture";
import StickySubmitBar from "@/components/logger/StickySubmitBar";

interface Props {
  animalTag: string;
  onSubmit: (data: { weightKg: number; photoBlob: Blob | null }) => Promise<void>;
  onCancel: () => void;
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-t-3xl max-h-[88vh] flex flex-col shadow-2xl"
        style={{ backgroundColor: '#1E0F07' }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(139, 105, 20, 0.4)' }} />
        </div>
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid rgba(92, 61, 46, 0.4)' }}
        >
          <h2
            className="font-bold text-lg"
            style={{ fontFamily: 'var(--font-display)', color: '#F5F0E8' }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full text-xl"
            style={{ backgroundColor: 'rgba(92, 61, 46, 0.5)', color: '#D2B48C' }}
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

export default function WeighingForm({ animalTag, onSubmit, onCancel }: Props) {
  const [weightKg, setWeightKg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  async function submit() {
    const weight = parseFloat(weightKg);
    if (isNaN(weight) || weight <= 0) return;

    setSubmitting(true);
    setError("");
    try {
      await onSubmit({ weightKg: weight, photoBlob });
      setWeightKg("");
      setPhotoBlob(null);
    } catch {
      setError("Failed to queue — try again");
    } finally {
      setSubmitting(false);
    }
  }

  const isValid = weightKg !== "" && !isNaN(parseFloat(weightKg)) && parseFloat(weightKg) > 0;

  return (
    <BottomSheet title={`Weigh — ${animalTag}`} onClose={onCancel}>
      <div className="p-5 flex flex-col gap-6">
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>
            Weight (kg)
          </p>
          <input
            type="number"
            step="0.1"
            min="0"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="e.g. 245.5"
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:text-[#8B6914]/60"
            style={{
              backgroundColor: 'rgba(26, 13, 5, 0.6)',
              border: '1px solid rgba(92, 61, 46, 0.5)',
              color: '#F5F0E8',
            }}
          />
        </div>

        <PhotoCapture onPhotoCapture={(blob) => setPhotoBlob(blob)} />

        {error && (
          <p className="text-sm text-center" style={{ color: '#C0574C' }}>{error}</p>
        )}

        <StickySubmitBar>
          <button
            onClick={submit}
            disabled={!isValid || submitting}
            className="w-full font-bold py-4 rounded-2xl text-base transition-colors"
            style={
              !isValid || submitting
                ? { backgroundColor: 'rgba(92, 61, 46, 0.3)', color: '#D2B48C' }
                : { backgroundColor: '#B87333', color: '#F5F0E8' }
            }
          >
            {submitting ? "Saving..." : "Submit Weight"}
          </button>
        </StickySubmitBar>
      </div>
    </BottomSheet>
  );
}
