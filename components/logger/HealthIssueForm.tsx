"use client";

import { useState } from "react";
import { PhotoCapture } from "@/components/logger/PhotoCapture";

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
  onSubmit?: (data: { symptoms: string[]; severity: string; photoBlob: Blob | null }) => void;
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-t-3xl max-h-[88vh] flex flex-col shadow-2xl"
        style={{ backgroundColor: '#1E0F07' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(139, 105, 20, 0.4)' }} />
        </div>
        {/* Header */}
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

  function toggleSymptom(s: string) {
    setSelectedSymptoms((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  function submit() {
    if (onSubmit) {
      onSubmit({ symptoms: selectedSymptoms, severity, photoBlob });
    } else {
      alert(`Health report submitted for ${animalId}\nSymptoms: ${selectedSymptoms.join(", ") || "None"}\nSeverity: ${severity}`);
      onClose();
    }
  }

  return (
    <BottomSheet title={`Health Report — ${animalId}`} onClose={onClose}>
      <div className="p-5 flex flex-col gap-6">
        {/* Symptoms */}
        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: '#D2B48C' }}>
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
                    ? { border: '2px solid #B87333', backgroundColor: 'rgba(184,115,51,0.2)', color: '#F5F0E8' }
                    : { border: '1px solid rgba(92, 61, 46, 0.4)', backgroundColor: 'rgba(44, 21, 8, 0.5)', color: '#D2B48C' }
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Severity */}
        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: '#D2B48C' }}>Severity</p>
          <div className="flex flex-col gap-2">
            {SEVERITIES.map((sev) => (
              <button
                key={sev.value}
                onClick={() => setSeverity(sev.value)}
                className="px-4 py-3 rounded-xl text-sm font-medium text-left transition-colors"
                style={
                  severity === sev.value
                    ? { border: '2px solid #B87333', backgroundColor: 'rgba(184,115,51,0.2)', color: '#F5F0E8' }
                    : { border: '1px solid rgba(92, 61, 46, 0.4)', backgroundColor: 'rgba(44, 21, 8, 0.5)', color: '#D2B48C' }
                }
              >
                {sev.label}
              </button>
            ))}
          </div>
        </div>

        {/* Photo */}
        <PhotoCapture onPhotoCapture={(blob) => setPhotoBlob(blob)} />

        {/* Submit */}
        <button
          onClick={submit}
          disabled={selectedSymptoms.length === 0}
          className="w-full font-bold py-4 rounded-2xl text-base transition-colors"
          style={
            selectedSymptoms.length === 0
              ? { backgroundColor: 'rgba(92, 61, 46, 0.3)', color: '#D2B48C' }
              : { backgroundColor: '#B87333', color: '#F5F0E8' }
          }
        >
          Submit Report
        </button>
      </div>
    </BottomSheet>
  );
}
