"use client";

import { useState } from "react";

type ReproType = "heat_detection" | "insemination" | "pregnancy_scan" | "calving";

export interface ReproSubmitData {
  type: ReproType;
  details: Record<string, string>;
}

interface Props {
  animalId: string;
  onClose: () => void;
  onSubmit: (data: ReproSubmitData) => void;
}

function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-t-3xl max-h-[88vh] flex flex-col shadow-2xl"
        style={{ backgroundColor: "#1E0F07" }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div
            className="w-10 h-1.5 rounded-full"
            style={{ backgroundColor: "rgba(139, 105, 20, 0.4)" }}
          />
        </div>
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: "1px solid rgba(92, 61, 46, 0.4)" }}
        >
          <h2
            className="font-bold text-lg"
            style={{ fontFamily: "var(--font-display)", color: "#F5F0E8" }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full text-xl"
            style={{ backgroundColor: "rgba(92, 61, 46, 0.5)", color: "#D2B48C" }}
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

const TYPE_OPTIONS: { value: ReproType; label: string; icon: string; desc: string }[] = [
  {
    value: "heat_detection",
    label: "Heat / Oestrus",
    icon: "🔥",
    desc: "Animal observed in standing heat",
  },
  {
    value: "insemination",
    label: "Insemination",
    icon: "💉",
    desc: "AI or natural service recorded",
  },
  {
    value: "pregnancy_scan",
    label: "Pregnancy Scan",
    icon: "🔬",
    desc: "Pregnancy diagnosis result",
  },
  {
    value: "calving",
    label: "Calving",
    icon: "🐮",
    desc: "Dam calved — record calf outcome",
  },
];

const SELECTED_STYLE = {
  border: "2px solid #B87333",
  backgroundColor: "rgba(184,115,51,0.2)",
  color: "#F5F0E8",
};
const DEFAULT_STYLE = {
  border: "1px solid rgba(92, 61, 46, 0.4)",
  backgroundColor: "rgba(44, 21, 8, 0.5)",
  color: "#D2B48C",
};

export default function ReproductionForm({ animalId, onClose, onSubmit }: Props) {
  const [step, setStep] = useState<"type" | "details">("type");
  const [selectedType, setSelectedType] = useState<ReproType | null>(null);

  // Heat detection
  const [heatMethod, setHeatMethod] = useState<"visual" | "scratch_card">("visual");

  // Insemination
  const [insemMethod, setInsemMethod] = useState<"AI" | "natural">("AI");
  const [bullId, setBullId] = useState("");

  // Pregnancy scan
  const [scanResult, setScanResult] = useState<"pregnant" | "empty" | "uncertain">("pregnant");
  const [scanNotes, setScanNotes] = useState("");

  // Calving
  const [calfStatus, setCalfStatus] = useState<"live" | "stillborn">("live");
  const [calfTag, setCalfTag] = useState("");

  function handleTypeSelect(type: ReproType) {
    setSelectedType(type);
    setStep("details");
  }

  function handleSubmit() {
    if (!selectedType) return;

    let details: Record<string, string>;
    if (selectedType === "heat_detection") {
      details = { method: heatMethod };
    } else if (selectedType === "insemination") {
      details = {
        method: insemMethod,
        ...(bullId.trim() ? { bullId: bullId.trim() } : {}),
      };
    } else if (selectedType === "pregnancy_scan") {
      details = {
        result: scanResult,
        ...(scanNotes.trim() ? { notes: scanNotes.trim() } : {}),
      };
    } else {
      // calving
      details = {
        calf_status: calfStatus,
        ...(calfTag.trim() ? { calf_tag: calfTag.trim() } : {}),
      };
    }

    onSubmit({ type: selectedType, details });
  }

  const title =
    step === "type"
      ? `Repro Record — ${animalId}`
      : `${TYPE_OPTIONS.find((t) => t.value === selectedType)?.label} — ${animalId}`;

  return (
    <BottomSheet title={title} onClose={onClose}>
      <div className="p-5 flex flex-col gap-4">
        {/* Step 1: choose event type */}
        {step === "type" && (
          <>
            <p className="text-sm" style={{ color: "#D2B48C" }}>
              Select the type of reproductive event:
            </p>
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleTypeSelect(opt.value)}
                className="w-full text-left px-4 py-4 rounded-xl flex items-center gap-4 transition-colors active:scale-95"
                style={DEFAULT_STYLE}
              >
                <span className="text-2xl leading-none shrink-0">{opt.icon}</span>
                <div>
                  <p className="font-semibold text-sm" style={{ color: "#F5F0E8" }}>
                    {opt.label}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(210, 180, 140, 0.7)" }}>
                    {opt.desc}
                  </p>
                </div>
              </button>
            ))}
          </>
        )}

        {/* Step 2a: heat detection */}
        {step === "details" && selectedType === "heat_detection" && (
          <>
            <p className="text-sm font-semibold" style={{ color: "#D2B48C" }}>
              How was heat detected?
            </p>
            {(
              [
                { value: "visual" as const, label: "Visual observation (standing heat)" },
                { value: "scratch_card" as const, label: "Scratch card / Kamar patch" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setHeatMethod(opt.value)}
                className="w-full text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-colors"
                style={heatMethod === opt.value ? SELECTED_STYLE : DEFAULT_STYLE}
              >
                {opt.label}
              </button>
            ))}
            <button
              onClick={handleSubmit}
              className="w-full font-bold py-4 rounded-2xl text-base mt-2"
              style={{ backgroundColor: "#B87333", color: "#F5F0E8" }}
            >
              Record Heat
            </button>
          </>
        )}

        {/* Step 2b: insemination */}
        {step === "details" && selectedType === "insemination" && (
          <>
            <p className="text-sm font-semibold" style={{ color: "#D2B48C" }}>
              Service method
            </p>
            {(
              [
                { value: "AI" as const, label: "AI — Artificial insemination" },
                { value: "natural" as const, label: "Natural service (bull)" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setInsemMethod(opt.value)}
                className="w-full text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-colors"
                style={insemMethod === opt.value ? SELECTED_STYLE : DEFAULT_STYLE}
              >
                {opt.label}
              </button>
            ))}
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: "#D2B48C" }}>
                Bull tag (optional)
              </p>
              <input
                type="text"
                value={bullId}
                onChange={(e) => setBullId(e.target.value)}
                placeholder="e.g. BULL-001"
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:opacity-40"
                style={{
                  backgroundColor: "rgba(26, 13, 5, 0.6)",
                  border: "1px solid rgba(92, 61, 46, 0.5)",
                  color: "#F5F0E8",
                }}
              />
            </div>
            <button
              onClick={handleSubmit}
              className="w-full font-bold py-4 rounded-2xl text-base mt-2"
              style={{ backgroundColor: "#B87333", color: "#F5F0E8" }}
            >
              Record Insemination
            </button>
          </>
        )}

        {/* Step 2c: pregnancy scan */}
        {step === "details" && selectedType === "pregnancy_scan" && (
          <>
            <p className="text-sm font-semibold" style={{ color: "#D2B48C" }}>
              Scan result
            </p>
            {(
              [
                { value: "pregnant" as const, label: "✓  Pregnant" },
                { value: "empty" as const, label: "✗  Empty" },
                { value: "uncertain" as const, label: "?  Uncertain — recheck" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setScanResult(opt.value)}
                className="w-full text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-colors"
                style={scanResult === opt.value ? SELECTED_STYLE : DEFAULT_STYLE}
              >
                {opt.label}
              </button>
            ))}
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: "#D2B48C" }}>
                Notes (optional)
              </p>
              <textarea
                value={scanNotes}
                onChange={(e) => setScanNotes(e.target.value)}
                rows={2}
                placeholder="Any additional observations..."
                className="w-full rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:opacity-40"
                style={{
                  backgroundColor: "rgba(26, 13, 5, 0.6)",
                  border: "1px solid rgba(92, 61, 46, 0.5)",
                  color: "#F5F0E8",
                }}
              />
            </div>
            <button
              onClick={handleSubmit}
              className="w-full font-bold py-4 rounded-2xl text-base mt-2"
              style={{ backgroundColor: "#B87333", color: "#F5F0E8" }}
            >
              Record Scan Result
            </button>
          </>
        )}

        {/* Step 2d: calving */}
        {step === "details" && selectedType === "calving" && (
          <>
            <p className="text-sm font-semibold" style={{ color: "#D2B48C" }}>
              Calf outcome
            </p>
            {(
              [
                { value: "live" as const, label: "🐄  Live calf" },
                { value: "stillborn" as const, label: "✗  Stillborn" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setCalfStatus(opt.value)}
                className="w-full text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-colors"
                style={calfStatus === opt.value ? SELECTED_STYLE : DEFAULT_STYLE}
              >
                {opt.label}
              </button>
            ))}
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: "#D2B48C" }}>
                Calf tag (optional)
              </p>
              <input
                type="text"
                value={calfTag}
                onChange={(e) => setCalfTag(e.target.value)}
                placeholder="e.g. CALF-2026-001"
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:opacity-40"
                style={{
                  backgroundColor: "rgba(26, 13, 5, 0.6)",
                  border: "1px solid rgba(92, 61, 46, 0.5)",
                  color: "#F5F0E8",
                }}
              />
            </div>
            <button
              onClick={handleSubmit}
              className="w-full font-bold py-4 rounded-2xl text-base mt-2"
              style={{ backgroundColor: "#B87333", color: "#F5F0E8" }}
            >
              Record Calving
            </button>
          </>
        )}

        {/* Back link when on details step */}
        {step === "details" && (
          <button
            onClick={() => setStep("type")}
            className="text-sm py-1 text-center"
            style={{ color: "rgba(210, 180, 140, 0.5)" }}
          >
            ← Back
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
