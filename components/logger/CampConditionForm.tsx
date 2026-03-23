"use client";

import { useState } from "react";
import type { GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";

interface Props {
  campId: string;
  onClose: () => void;
  onSkip?: () => void;
  onSubmit?: (data: { campId: string; grazing: GrazingQuality; water: WaterStatus; fence: FenceStatus; notes: string }) => void;
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

type OptionCard<T> = { value: T; label: string; icon: string; color: string };

function CardGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: OptionCard<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold mb-3" style={{ color: '#D2B48C' }}>{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-medium transition-colors ${
              value === opt.value ? opt.color : ""
            }`}
            style={
              value !== opt.value
                ? { border: '1px solid rgba(92, 61, 46, 0.4)', backgroundColor: 'rgba(44, 21, 8, 0.5)', color: '#D2B48C' }
                : {}
            }
          >
            <span className="text-xl">{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const GRAZING_OPTIONS: OptionCard<GrazingQuality>[] = [
  { value: "Good",       label: "Good",      icon: "🟢", color: "border-lime-700 bg-lime-900/40 text-lime-300" },
  { value: "Fair",       label: "Fair",   icon: "🟡", color: "border-amber-600 bg-amber-900/40 text-amber-300" },
  { value: "Poor",       label: "Poor",      icon: "🟠", color: "border-orange-700 bg-orange-900/40 text-orange-300" },
  { value: "Overgrazed", label: "Overgrazed", icon: "🔴", color: "border-red-700 bg-red-900/40 text-red-300" },
];

const WATER_OPTIONS: OptionCard<WaterStatus>[] = [
  { value: "Full",   label: "Full",      icon: "💧", color: "border-sky-600 bg-sky-900/40 text-sky-300" },
  { value: "Low",    label: "Low",     icon: "🔵", color: "border-sky-500 bg-sky-900/30 text-sky-400" },
  { value: "Empty",  label: "Empty",     icon: "⚠️", color: "border-amber-600 bg-amber-900/40 text-amber-300" },
  { value: "Broken", label: "Broken", icon: "🔧", color: "border-red-700 bg-red-900/40 text-red-300" },
];

const FENCE_OPTIONS: OptionCard<FenceStatus>[] = [
  { value: "Intact",  label: "Intact",     icon: "✅", color: "border-lime-700 bg-lime-900/40 text-lime-300" },
  { value: "Damaged", label: "Damaged", icon: "⚠️", color: "border-red-700 bg-red-900/40 text-red-300" },
];

export default function CampConditionForm({ campId, onClose, onSkip, onSubmit }: Props) {
  const [grazing, setGrazing] = useState<GrazingQuality>("Good");
  const [water, setWater] = useState<WaterStatus>("Full");
  const [fence, setFence] = useState<FenceStatus>("Intact");
  const [notes, setNotes] = useState("");

  function submit() {
    if (onSubmit) {
      onSubmit({ campId, grazing, water, fence, notes });
    } else {
      alert(`Camp ${campId} condition recorded:\nGrazing: ${grazing}\nWater: ${water}\nFence: ${fence}`);
      onClose();
    }
  }

  return (
    <BottomSheet title={`Camp Condition — ${campId}`} onClose={onClose}>
      <div className="p-5 flex flex-col gap-6">
        <CardGroup label="Grazing condition" options={GRAZING_OPTIONS} value={grazing} onChange={setGrazing} />
        <CardGroup label="Water status" options={WATER_OPTIONS} value={water} onChange={setWater} />
        <CardGroup label="Fence" options={FENCE_OPTIONS} value={fence} onChange={setFence} />

        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>Notes (optional)</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Any additional remarks..."
            className="w-full rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:text-[#8B6914]/60"
            style={{
              backgroundColor: 'rgba(26, 13, 5, 0.6)',
              border: '1px solid rgba(92, 61, 46, 0.5)',
              color: '#F5F0E8',
            }}
          />
        </div>

        <button
          onClick={submit}
          className="w-full font-bold py-4 rounded-2xl text-base transition-colors"
          style={{ backgroundColor: '#B87333', color: '#F5F0E8' }}
        >
          Submit Camp Report
        </button>

        {onSkip && (
          <button
            onClick={onSkip}
            className="w-full py-3 text-sm font-medium transition-colors rounded-2xl active:scale-95"
            style={{
              color: 'rgba(210, 180, 140, 0.78)',
              backgroundColor: 'rgba(92, 61, 46, 0.2)',
              border: '1px solid rgba(92, 61, 46, 0.3)',
            }}
          >
            Skip for now →
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
