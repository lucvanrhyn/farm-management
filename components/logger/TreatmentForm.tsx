"use client";

import { useState, useEffect, useRef } from "react";
import { PhotoCapture } from "@/components/logger/PhotoCapture";
import StickySubmitBar from "@/components/logger/StickySubmitBar";

interface Props {
  animalTag: string;
  onSubmit: (data: {
    treatmentType: TreatmentType;
    product: string;
    dose: string;
    withdrawalDays: number;
    photoBlob: Blob | null;
  }) => Promise<void>;
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
        style={{ backgroundColor: 'var(--ft-surface)' }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full" style={{ backgroundColor: 'var(--ft-border2)' }} />
        </div>
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--ft-border)' }}
        >
          <h2
            className="font-bold text-lg"
            style={{ fontFamily: 'var(--ft-font-serif)', color: 'var(--ft-text)' }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full text-xl"
            style={{ backgroundColor: 'var(--ft-border2)', color: 'var(--ft-muted)' }}
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

export default function TreatmentForm({ animalTag, onSubmit, onCancel }: Props) {
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

  // S6 / OS-3 (#482 WeighingForm pattern) — synchronous in-flight latch. The
  // `submitting` STATE drives the disabled/“Saving…” UX, but state updates are
  // async/batched, so a second tap fired in the SAME tick still sees
  // `submitting === false` and would enqueue a second observation (each
  // enqueue mints its own clientLocalId → two server rows). The ref is set
  // synchronously BEFORE any await; reset in `finally` so a legitimate later
  // submit works after success OR failure.
  const inFlightRef = useRef(false);

  async function submit() {
    if (inFlightRef.current) return;
    if (!product.trim() || !dose.trim()) return;

    inFlightRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({ treatmentType, product: product.trim(), dose: dose.trim(), withdrawalDays, photoBlob });
      setTreatmentType("Antibiotic");
      setProduct("");
      setDose("");
      setWithdrawalDays(DEFAULT_WITHDRAWAL_DAYS["Antibiotic"]);
      setPhotoBlob(null);
    } catch {
      setError("Failed to queue — try again");
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  const isValid = product.trim() !== "" && dose.trim() !== "";

  return (
    <BottomSheet title={`Treatment — ${animalTag}`} onClose={onCancel}>
      <div className="p-5 flex flex-col gap-6">
        {/* Treatment Type */}
        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--ft-muted)' }}>
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
                    ? { border: '2px solid var(--ft-accent)', backgroundColor: 'var(--ft-accent-faint)', color: 'var(--ft-text)' }
                    : { border: '1px solid var(--ft-border)', backgroundColor: 'var(--ft-surface2)', color: 'var(--ft-muted)' }
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Product */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--ft-muted)' }}>
            Product
          </p>
          <input
            type="text"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="e.g. Terramycin"
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-accent)] placeholder:text-[var(--ft-subtle)]"
            style={{
              backgroundColor: 'var(--ft-surface2)',
              border: '1px solid var(--ft-border2)',
              color: 'var(--ft-text)',
            }}
          />
        </div>

        {/* Dose */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--ft-muted)' }}>
            Dose
          </p>
          <input
            type="text"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            placeholder="e.g. 5ml"
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-accent)] placeholder:text-[var(--ft-subtle)]"
            style={{
              backgroundColor: 'var(--ft-surface2)',
              border: '1px solid var(--ft-border2)',
              color: 'var(--ft-text)',
            }}
          />
        </div>

        {/* Withdrawal Days */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--ft-muted)' }}>
            Withdrawal Period (days)
          </p>
          <input
            type="number"
            min="0"
            value={withdrawalDays}
            onChange={(e) => setWithdrawalDays(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-accent)] placeholder:text-[var(--ft-subtle)]"
            style={{
              backgroundColor: 'var(--ft-surface2)',
              border: '1px solid var(--ft-border2)',
              color: 'var(--ft-text)',
            }}
          />
        </div>

        {/* Photo */}
        <PhotoCapture onPhotoCapture={(blob) => setPhotoBlob(blob)} />

        {error && (
          <p className="text-sm text-center" style={{ color: 'var(--ft-poor)' }}>{error}</p>
        )}

        <StickySubmitBar>
          <button
            onClick={submit}
            disabled={!isValid || submitting}
            className="w-full font-bold py-4 rounded-2xl text-base transition-colors"
            style={
              !isValid || submitting
                ? { backgroundColor: 'var(--ft-surface2)', color: 'var(--ft-muted)' }
                : { backgroundColor: 'var(--ft-accent)', color: 'var(--ft-on-accent)' }
            }
          >
            {submitting ? "Saving..." : "Submit Treatment"}
          </button>
        </StickySubmitBar>
      </div>
    </BottomSheet>
  );
}
