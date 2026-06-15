"use client";

import { useRef, useState } from "react";
import { PhotoCapture } from "@/components/logger/PhotoCapture";
import StickySubmitBar from "@/components/logger/StickySubmitBar";

const SYMPTOMS = [
  "Lame",
  "Thin",
  "Eye problem",
  "Wound",
  "Diarrhea",
  "Nasal discharge",
  "Bloated",
  "Not eating",
  "Other",
];

const SEVERITIES = [
  { value: "mild",     label: "Mild case" },
  { value: "moderate", label: "Moderate case" },
  { value: "severe",   label: "Severe — urgent attention" },
];

interface Props {
  animalId: string;
  campId: string;
  onClose: () => void;
  // S6 / OS-3 — widened to accept a promise so the in-flight latch can hold
  // until the parent's async queue write settles. The Logger page handler is
  // an async function; the old `void` signature silently dropped its promise,
  // leaving the form no way to know when the enqueue finished.
  onSubmit?: (data: { symptoms: string[]; severity: string; photoBlob: Blob | null }) => void | Promise<void>;
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-t-3xl max-h-[88vh] flex flex-col shadow-2xl"
        style={{ backgroundColor: 'var(--ft-surface)' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full" style={{ backgroundColor: 'var(--ft-border2)' }} />
        </div>
        {/* Header */}
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
        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

export default function HealthIssueForm({ animalId, campId: _campId, onClose, onSubmit }: Props) {
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [severity, setSeverity] = useState("mild");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // S6 / OS-3 (#482 WeighingForm pattern) — synchronous in-flight latch. This
  // form had NO submit guard at all: a double-tap fired `onSubmit` twice and
  // each enqueue mints its own clientLocalId → two server rows. The ref is set
  // synchronously BEFORE any await so the same-tick second tap is swallowed;
  // `submitting` state covers the cross-render window; reset in `finally` so a
  // legitimate later submit works after success OR failure.
  const inFlightRef = useRef(false);

  function toggleSymptom(s: string) {
    setSelectedSymptoms((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function submit() {
    if (inFlightRef.current) return;
    if (selectedSymptoms.length === 0) return;

    inFlightRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (onSubmit) {
        await onSubmit({ symptoms: selectedSymptoms, severity, photoBlob });
      } else {
        alert(`Health report submitted for ${animalId}\nSymptoms: ${selectedSymptoms.join(", ") || "None"}\nSeverity: ${severity}`);
        onClose();
      }
    } catch {
      setError("Failed to queue — try again");
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet title={`Health Report — ${animalId}`} onClose={onClose}>
      <div className="p-5 flex flex-col gap-6">
        {/* Symptoms */}
        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--ft-muted)' }}>
            Symptoms (select all that apply)
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SYMPTOMS.map((s) => (
              <button
                key={s}
                onClick={() => toggleSymptom(s)}
                className="px-4 py-3 rounded-xl text-sm font-medium text-left transition-colors"
                style={
                  selectedSymptoms.includes(s)
                    ? { border: '2px solid var(--ft-accent)', backgroundColor: 'var(--ft-accent-faint)', color: 'var(--ft-text)' }
                    : { border: '1px solid var(--ft-border)', backgroundColor: 'var(--ft-surface2)', color: 'var(--ft-muted)' }
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Severity */}
        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--ft-muted)' }}>Severity</p>
          <div className="flex flex-col gap-2">
            {SEVERITIES.map((sev) => (
              <button
                key={sev.value}
                onClick={() => setSeverity(sev.value)}
                className="px-4 py-3 rounded-xl text-sm font-medium text-left transition-colors"
                style={
                  severity === sev.value
                    ? { border: '2px solid var(--ft-accent)', backgroundColor: 'var(--ft-accent-faint)', color: 'var(--ft-text)' }
                    : { border: '1px solid var(--ft-border)', backgroundColor: 'var(--ft-surface2)', color: 'var(--ft-muted)' }
                }
              >
                {sev.label}
              </button>
            ))}
          </div>
        </div>

        {/* Photo */}
        <PhotoCapture onPhotoCapture={(blob) => setPhotoBlob(blob)} />

        {error && (
          <p className="text-sm text-center" style={{ color: 'var(--ft-poor)' }}>{error}</p>
        )}

        {/* Submit — wrapped in StickySubmitBar (wave/262) so it stays in view
            on 390x844 viewports without scrolling past PhotoCapture. */}
        <StickySubmitBar>
          <button
            onClick={submit}
            disabled={selectedSymptoms.length === 0 || submitting}
            className="w-full font-bold py-4 rounded-2xl text-base transition-colors"
            style={
              selectedSymptoms.length === 0 || submitting
                ? { backgroundColor: 'var(--ft-surface2)', color: 'var(--ft-muted)' }
                : { backgroundColor: 'var(--ft-accent)', color: 'var(--ft-on-accent)' }
            }
          >
            {submitting ? "Saving..." : "Submit Report"}
          </button>
        </StickySubmitBar>
      </div>
    </BottomSheet>
  );
}
