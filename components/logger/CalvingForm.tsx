"use client";

import { useState } from "react";
import type { AnimalSex, EaseOfBirth } from "@/lib/types";

interface Props {
  animalId: string;
  campId: string;
  onClose: () => void;
  onSubmit?: (data: { animalId: string; campId: string; calfSex: AnimalSex; calfAlive: boolean; easeOfBirth: EaseOfBirth; notes: string }) => void;
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

function SegmentGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; icon?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold mb-3" style={{ color: '#D2B48C' }}>{label}</p>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="flex-1 py-3.5 rounded-2xl text-sm font-bold transition-colors flex flex-col items-center gap-1"
            style={
              value === opt.value
                ? { border: '2px solid #B87333', backgroundColor: 'rgba(184,115,51,0.2)', color: '#F5F0E8' }
                : { border: '1px solid rgba(92, 61, 46, 0.4)', backgroundColor: 'rgba(44, 21, 8, 0.4)', color: '#D2B48C' }
            }
          >
            {opt.icon && <span className="text-xl">{opt.icon}</span>}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CalvingForm({ animalId, campId, onClose, onSubmit }: Props) {
  const [calfSex, setCalfSex] = useState<AnimalSex>("Female");
  const [calfAlive, setCalfAlive] = useState(true);
  const [ease, setEase] = useState<EaseOfBirth>("Unassisted");
  const [notes, setNotes] = useState("");

  function submit() {
    if (onSubmit) {
      onSubmit({ animalId, campId, calfSex, calfAlive, easeOfBirth: ease, notes });
    } else {
      alert(`Kalfgeboorte aangeteken vir ${animalId} in kamp ${campId}\nKalf geslag: ${calfSex}\nLewendig: ${calfAlive ? "Ja" : "Nee"}\nGemak: ${ease}`);
      onClose();
    }
  }

  return (
    <BottomSheet title={`Kalfgeboorte — ${animalId}`} onClose={onClose}>
      <div className="p-5 flex flex-col gap-6">
        <SegmentGroup
          label="Kalf geslag"
          value={calfSex}
          onChange={setCalfSex}
          options={[
            { value: "Female", label: "Vers",  icon: "🐄" },
            { value: "Male",   label: "Bulle", icon: "🐂" },
          ]}
        />

        <SegmentGroup
          label="Kalf lewend?"
          value={calfAlive ? "yes" : "no"}
          onChange={(v) => setCalfAlive(v === "yes")}
          options={[
            { value: "yes", label: "Lewend",     icon: "✅" },
            { value: "no",  label: "Doodgebore", icon: "❌" },
          ]}
        />

        <SegmentGroup
          label="Gemak van geboorte"
          value={ease}
          onChange={setEase}
          options={[
            { value: "Unassisted", label: "Alleen",  icon: "🟢" },
            { value: "Assisted",   label: "Gehelp",  icon: "🟡" },
            { value: "Difficult",  label: "Moeilik", icon: "🔴" },
          ]}
        />

        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>Notas (opsioneel)</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Enige addisionele inligting..."
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
          Teken Geboorte Aan
        </button>
      </div>
    </BottomSheet>
  );
}
