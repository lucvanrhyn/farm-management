"use client";

import { useState, useEffect } from "react";
import { PhotoCapture } from "@/components/logger/PhotoCapture";
import { queuePhoto } from "@/lib/offline-store";

interface Props {
  animalId: string;
  animalTag: string;
  campId: string;
  farmSlug: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const TREATMENT_TYPES = [
  "Antibiotic",
  "Dip",
  "Deworming",
  "Vaccination",
  "Supplement",
  "Other",
] as const;

type TreatmentType = typeof TREATMENT_TYPES[number];

const DEFAULT_WITHDRAWAL_DAYS: Record<TreatmentType, number> = {
  Antibiotic: 14,
  Dip: 7,
  Deworming: 7,
  Vaccination: 0,
  Supplement: 0,
  Other: 7,
};

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

export default function TreatmentForm({ animalId, animalTag, campId, farmSlug, onSuccess, onCancel }: Props) {
  const [treatmentType, setTreatmentType] = useState<TreatmentType>("Antibiotic");
  const [product, setProduct] = useState("");
  const [dose, setDose] = useState("");
  const [withdrawalDays, setWithdrawalDays] = useState(DEFAULT_WITHDRAWAL_DAYS["Antibiotic"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  useEffect(() => {
    setWithdrawalDays(DEFAULT_WITHDRAWAL_DAYS[treatmentType]);
  }, [treatmentType]);

  async function submit() {
    if (!product.trim() || !dose.trim()) return;

    setSubmitting(true);
    setError("");
    try {
      const detailsObj: Record<string, unknown> = {
        treatment_type: treatmentType,
        product: product.trim(),
        dose: dose.trim(),
        withdrawal_days: withdrawalDays,
      };

      const res = await fetch(`/api/observations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "treatment",
          camp_id: campId,
          animal_id: animalId,
          details: JSON.stringify(detailsObj),
          created_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error ?? "Failed to save — try again");
        return;
      }
      const resData = await res.json().catch(() => ({}));
      if (photoBlob && resData.id) {
        await queuePhoto(resData.id, photoBlob).catch(() => {/* non-fatal */});
      }
      setTreatmentType("Antibiotic");
      setProduct("");
      setDose("");
      setWithdrawalDays(DEFAULT_WITHDRAWAL_DAYS["Antibiotic"]);
      setPhotoBlob(null);
      onSuccess();
    } catch {
      setError("Network error — try again");
    } finally {
      setSubmitting(false);
    }
  }

  const isValid = product.trim() !== "" && dose.trim() !== "";

  return (
    <BottomSheet title={`Treatment — ${animalTag}`} onClose={onCancel}>
      <div className="p-5 flex flex-col gap-6">
        {/* Treatment Type */}
        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: '#D2B48C' }}>
            Treatment Type
          </p>
          <div className="grid grid-cols-2 gap-2">
            {TREATMENT_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setTreatmentType(t)}
                className="px-4 py-3 rounded-xl text-sm font-medium text-left transition-colors"
                style={
                  treatmentType === t
                    ? { border: '2px solid #B87333', backgroundColor: 'rgba(184,115,51,0.2)', color: '#F5F0E8' }
                    : { border: '1px solid rgba(92, 61, 46, 0.4)', backgroundColor: 'rgba(44, 21, 8, 0.5)', color: '#D2B48C' }
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Product */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>
            Product
          </p>
          <input
            type="text"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="e.g. Terramycin"
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:text-[#8B6914]/60"
            style={{
              backgroundColor: 'rgba(26, 13, 5, 0.6)',
              border: '1px solid rgba(92, 61, 46, 0.5)',
              color: '#F5F0E8',
            }}
          />
        </div>

        {/* Dose */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>
            Dose
          </p>
          <input
            type="text"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            placeholder="e.g. 5ml"
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:text-[#8B6914]/60"
            style={{
              backgroundColor: 'rgba(26, 13, 5, 0.6)',
              border: '1px solid rgba(92, 61, 46, 0.5)',
              color: '#F5F0E8',
            }}
          />
        </div>

        {/* Withdrawal Days */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>
            Withdrawal Period (days)
          </p>
          <input
            type="number"
            min="0"
            value={withdrawalDays}
            onChange={(e) => setWithdrawalDays(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:text-[#8B6914]/60"
            style={{
              backgroundColor: 'rgba(26, 13, 5, 0.6)',
              border: '1px solid rgba(92, 61, 46, 0.5)',
              color: '#F5F0E8',
            }}
          />
        </div>

        {/* Photo */}
        <PhotoCapture onPhotoCapture={(blob) => setPhotoBlob(blob)} />

        {error && (
          <p className="text-sm text-center" style={{ color: '#C0574C' }}>{error}</p>
        )}

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
          {submitting ? "Saving..." : "Submit Treatment"}
        </button>
      </div>
    </BottomSheet>
  );
}
