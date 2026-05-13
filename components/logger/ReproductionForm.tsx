"use client";

import { useState } from "react";
import { PhotoCapture } from "@/components/logger/PhotoCapture";

type ReproType = "heat_detection" | "insemination" | "pregnancy_scan" | "calving" | "body_condition_score" | "temperament_score" | "scrotal_circumference";

export interface ReproSubmitData {
  type: ReproType;
  details: Record<string, string>;
  photoBlob: Blob | null;
}

interface Props {
  animalId: string;
  animalSex?: "Male" | "Female";
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

const BASE_TYPE_OPTIONS: { value: ReproType; label: string; icon: string; desc: string; maleOnly?: boolean }[] = [
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
  {
    value: "body_condition_score",
    label: "Body Condition Score",
    icon: "📊",
    desc: "Score 1-9 body condition assessment",
  },
  {
    value: "temperament_score",
    label: "Temperament Score",
    icon: "🧠",
    desc: "Score 1-5 temperament assessment",
  },
  {
    value: "scrotal_circumference",
    label: "Scrotal Circumference",
    icon: "📏",
    desc: "Measure scrotal circumference (cm)",
    maleOnly: true,
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

const BCS_DESCRIPTIONS: Record<number, string> = {
  1: "Emaciated", 2: "Very thin", 3: "Thin",
  4: "Borderline", 5: "Moderate", 6: "Good",
  7: "Fleshy", 8: "Obese", 9: "Very obese",
};

const TEMPERAMENT_DESCRIPTIONS: Record<number, string> = {
  1: "Docile", 2: "Slightly restless", 3: "Restless",
  4: "Nervous", 5: "Flighty / Wild",
};

export default function ReproductionForm({ animalId, animalSex, onClose, onSubmit }: Props) {
  const [step, setStep] = useState<"type" | "details">("type");
  const [selectedType, setSelectedType] = useState<ReproType | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  // Heat detection
  const [heatMethod, setHeatMethod] = useState<"visual" | "scratch_card">("visual");

  // Insemination
  const [insemMethod, setInsemMethod] = useState<"AI" | "natural">("AI");
  const [bullId, setBullId] = useState("");

  // Pregnancy scan
  const [scanResult, setScanResult] = useState<"pregnant" | "empty" | "uncertain">("pregnant");

  // Calving
  const [calfStatus, setCalfStatus] = useState<"live" | "stillborn">("live");
  const [calfTag, setCalfTag] = useState("");

  // Body condition score
  const [bcsScore, setBcsScore] = useState(5);

  // Temperament score
  const [temperamentScore, setTemperamentScore] = useState(1);

  // Scrotal circumference
  const [scrotalCm, setScrotalCm] = useState("");

  // Filter type options based on animal sex
  const TYPE_OPTIONS = BASE_TYPE_OPTIONS.filter(
    (opt) => !opt.maleOnly || animalSex === "Male",
  );

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
      };
    } else if (selectedType === "body_condition_score") {
      details = { score: String(bcsScore) };
    } else if (selectedType === "temperament_score") {
      details = { score: String(temperamentScore) };
    } else if (selectedType === "scrotal_circumference") {
      if (!scrotalCm.trim()) {
        alert("Scrotal circumference measurement is required.");
        return;
      }
      details = { measurement_cm: scrotalCm.trim() };
    } else {
      // calving
      details = {
        calf_status: calfStatus,
        ...(calfTag.trim() ? { calf_tag: calfTag.trim() } : {}),
      };
    }

    onSubmit({ type: selectedType, details, photoBlob });
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
            <p className="text-sm font-semibold" id="repro-heat-method-label" style={{ color: "#D2B48C" }}>
              How was heat detected?
            </p>
            {/*
              Wave 1 / #253 — explicit `role="radiogroup"` so the In-Heat
              method picker is structurally a single-select. Server-side
              `validateReproductiveState` (lib/server/validators/reproductive-state.ts)
              is the defense-in-depth backstop — the radio role here is the
              UX-layer half of the fix.
            */}
            <div role="radiogroup" aria-labelledby="repro-heat-method-label">
              {(
                [
                  { value: "visual" as const, label: "Visual observation (standing heat)" },
                  { value: "scratch_card" as const, label: "Scratch card / Kamar patch" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={heatMethod === opt.value}
                  onClick={() => setHeatMethod(opt.value)}
                  className="w-full text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-colors mb-2"
                  style={heatMethod === opt.value ? SELECTED_STYLE : DEFAULT_STYLE}
                >
                  {opt.label}
                </button>
              ))}
            </div>
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
            <p className="text-sm font-semibold" id="repro-scan-result-label" style={{ color: "#D2B48C" }}>
              Scan result
            </p>
            {/*
              Wave 1 / #253 — explicit `role="radiogroup"` for the
              {Pregnant, Open (=Empty), Uncertain} mutually-exclusive states.
              The 2026-05-13 stress test confirmed dirty payloads with
              multiple state markers were silently collapsed at the DB.
              The server-side `ReproductiveStateValidator` rejects those
              with `422 REPRO_MULTI_STATE`; this radio is the UX-layer half
              of the defense-in-depth fix.
            */}
            <div role="radiogroup" aria-labelledby="repro-scan-result-label">
              {(
                [
                  { value: "pregnant" as const, label: "✓  Pregnant" },
                  { value: "empty" as const, label: "✗  Open (Empty)" },
                  { value: "uncertain" as const, label: "?  Uncertain — recheck" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={scanResult === opt.value}
                  onClick={() => setScanResult(opt.value)}
                  className="w-full text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-colors mb-2"
                  style={scanResult === opt.value ? SELECTED_STYLE : DEFAULT_STYLE}
                >
                  {opt.label}
                </button>
              ))}
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

        {/* Step 2e: body condition score */}
        {step === "details" && selectedType === "body_condition_score" && (
          <>
            <p className="text-sm font-semibold" style={{ color: "#D2B48C" }}>
              Body Condition Score (1-9)
            </p>
            <div className="flex flex-col gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
                const rangeLabel =
                  n <= 3 ? "Thin" : n <= 5 ? "Moderate" : n <= 7 ? "Good" : "Obese";
                return (
                  <button
                    key={n}
                    onClick={() => setBcsScore(n)}
                    className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                    style={bcsScore === n ? SELECTED_STYLE : DEFAULT_STYLE}
                  >
                    {n} — {BCS_DESCRIPTIONS[n]}{" "}
                    <span className="opacity-60">({rangeLabel})</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={handleSubmit}
              className="w-full font-bold py-4 rounded-2xl text-base mt-2"
              style={{ backgroundColor: "#B87333", color: "#F5F0E8" }}
            >
              Record BCS
            </button>
          </>
        )}

        {/* Step 2f: temperament score */}
        {step === "details" && selectedType === "temperament_score" && (
          <>
            <p className="text-sm font-semibold" style={{ color: "#D2B48C" }}>
              Temperament Score (1-5)
            </p>
            <div className="flex flex-col gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setTemperamentScore(n)}
                  className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                  style={temperamentScore === n ? SELECTED_STYLE : DEFAULT_STYLE}
                >
                  {n} — {TEMPERAMENT_DESCRIPTIONS[n]}
                </button>
              ))}
            </div>
            <button
              onClick={handleSubmit}
              className="w-full font-bold py-4 rounded-2xl text-base mt-2"
              style={{ backgroundColor: "#B87333", color: "#F5F0E8" }}
            >
              Record Temperament
            </button>
          </>
        )}

        {/* Step 2g: scrotal circumference */}
        {step === "details" && selectedType === "scrotal_circumference" && (
          <>
            <p className="text-sm font-semibold" style={{ color: "#D2B48C" }}>
              Scrotal Circumference
            </p>
            <div>
              <p className="text-sm mb-2" style={{ color: "#D2B48C" }}>
                Measurement in cm
              </p>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="20"
                max="50"
                value={scrotalCm}
                onChange={(e) => setScrotalCm(e.target.value)}
                placeholder="e.g. 36"
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
              Record Scrotal Circumference
            </button>
          </>
        )}

        {/* Photo capture — shown on the details step */}
        {step === "details" && (
          <PhotoCapture onPhotoCapture={(blob) => setPhotoBlob(blob)} />
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
