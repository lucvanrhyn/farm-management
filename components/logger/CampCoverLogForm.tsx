"use client";

import { useState } from "react";
import { PhotoCapture } from "@/components/logger/PhotoCapture";
import { queuePhoto } from "@/lib/offline-store";

interface Props {
  campId: string;
  campName: string;
  farmSlug: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const COVER_CATEGORIES = [
  {
    value: "Good",
    label: "Good",
    desc: "Thick grass, minimal bare ground",
    hint: "approx 2000 kg DM/ha",
    icon: "🟢",
    color: "border-lime-700 bg-lime-900/40 text-lime-300",
  },
  {
    value: "Fair",
    label: "Fair",
    desc: "Moderate grass, some bare patches",
    hint: "approx 1100 kg DM/ha",
    icon: "🟡",
    color: "border-amber-600 bg-amber-900/40 text-amber-300",
  },
  {
    value: "Poor",
    label: "Poor",
    desc: "Sparse grass, significant bare ground",
    hint: "approx 450 kg DM/ha",
    icon: "🔴",
    color: "border-red-700 bg-red-900/40 text-red-300",
  },
] as const;

type CoverCategory = "Good" | "Fair" | "Poor";

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

export default function CampCoverLogForm({ campId, campName, farmSlug, onSuccess, onCancel }: Props) {
  const [coverCategory, setCoverCategory] = useState<CoverCategory | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  async function submit() {
    if (!coverCategory) return;

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/${farmSlug}/camps/${campId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coverCategory,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error ?? "Failed to save — try again");
        return;
      }
      const resData = await res.json().catch(() => ({}));
      const recordId = resData.reading?.id ?? resData.id;
      if (photoBlob && recordId) {
        await queuePhoto(String(recordId), photoBlob).catch(() => {/* non-fatal */});
      }
      setCoverCategory(null);
      setNotes("");
      setPhotoBlob(null);
      onSuccess();
    } catch {
      setError("Network error — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet title={`Pasture Cover — ${campName}`} onClose={onCancel}>
      <div className="p-5 flex flex-col gap-6">
        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: '#D2B48C' }}>
            Cover Category
          </p>
          <div className="flex flex-col gap-2">
            {COVER_CATEGORIES.map((cat) => {
              const isSelected = coverCategory === cat.value;
              return (
                <button
                  key={cat.value}
                  onClick={() => setCoverCategory(cat.value)}
                  className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-medium transition-colors ${
                    isSelected ? cat.color : ""
                  }`}
                  style={
                    !isSelected
                      ? { border: '1px solid rgba(92, 61, 46, 0.4)', backgroundColor: 'rgba(44, 21, 8, 0.5)', color: '#D2B48C' }
                      : {}
                  }
                >
                  <span className="text-xl">{cat.icon}</span>
                  <div className="text-left">
                    <span className="block">{cat.label}</span>
                    <span className="block text-xs opacity-70">{cat.hint}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <PhotoCapture onPhotoCapture={(blob) => setPhotoBlob(blob)} />

        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>
            Notes (optional)
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Any additional remarks..."
            className="w-full rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:text-[#8B6914]/60"
            style={{
              backgroundColor: 'rgba(26, 13, 5, 0.6)',
              border: '1px solid rgba(92, 61, 46, 0.5)',
              color: '#F5F0E8',
            }}
          />
        </div>

        {error && (
          <p className="text-sm text-center" style={{ color: '#C0574C' }}>{error}</p>
        )}

        <button
          onClick={submit}
          disabled={!coverCategory || submitting}
          className="w-full font-bold py-4 rounded-2xl text-base transition-colors"
          style={
            !coverCategory || submitting
              ? { backgroundColor: 'rgba(92, 61, 46, 0.3)', color: '#D2B48C' }
              : { backgroundColor: '#B87333', color: '#F5F0E8' }
          }
        >
          {submitting ? "Saving..." : "Record Cover"}
        </button>
      </div>
    </BottomSheet>
  );
}
