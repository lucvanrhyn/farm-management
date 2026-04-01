"use client";

import { useState } from "react";
import type { AnimalSex, EaseOfBirth } from "@/lib/types";
import { PhotoCapture } from "@/components/logger/PhotoCapture";

interface Bull {
  animalId: string;
  name: string | null;
}

interface Props {
  animalId: string;
  campId: string;
  bulls?: Bull[];
  onClose: () => void;
  onSubmit?: (data: {
    animalId: string;
    campId: string;
    calfAnimalId: string;
    calfName: string;
    calfSex: AnimalSex;
    calfAlive: boolean;
    easeOfBirth: EaseOfBirth;
    fatherId: string | null;
    dateOfBirth: string;
    breed: string;
    category: string;
    notes: string;
    photoBlob: Blob | null;
  }) => void;
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

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>
        {label}{required && <span style={{ color: '#C0574C' }}> *</span>}
      </p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:text-[#8B6914]/60"
        style={{
          backgroundColor: 'rgba(26, 13, 5, 0.6)',
          border: '1px solid rgba(92, 61, 46, 0.5)',
          color: '#F5F0E8',
        }}
      />
    </div>
  );
}

export default function CalvingForm({ animalId, campId, bulls = [], onClose, onSubmit }: Props) {
  const today = new Date().toISOString().split("T")[0];

  const [calfAnimalId, setCalfAnimalId] = useState("");
  const [calfName, setCalfName] = useState("");
  const [calfSex, setCalfSex] = useState<AnimalSex>("Female");
  const [calfAlive, setCalfAlive] = useState(true);
  const [ease, setEase] = useState<EaseOfBirth>("Unassisted");
  const [fatherId, setFatherId] = useState<string>("");
  const [dateOfBirth, setDateOfBirth] = useState(today);
  const [breed, setBreed] = useState("Brangus");
  const [category, setCategory] = useState("Calf");
  const [notes, setNotes] = useState("");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  function submit() {
    if (!calfAnimalId.trim()) {
      alert("Ear tag (animal ID) is required.");
      return;
    }
    if (onSubmit) {
      onSubmit({
        animalId,
        campId,
        calfAnimalId: calfAnimalId.trim(),
        calfName,
        calfSex,
        calfAlive,
        easeOfBirth: ease,
        fatherId: fatherId || null,
        dateOfBirth,
        breed: breed || "Brangus",
        category: category || "Calf",
        notes,
        photoBlob,
      });
    } else {
      alert(`Calving recorded for ${animalId} in camp ${campId}\nCalf ID: ${calfAnimalId}\nSex: ${calfSex}\nAlive: ${calfAlive ? "Yes" : "No"}\nEase: ${ease}`);
      onClose();
    }
  }

  return (
    <BottomSheet title={`Calving — ${animalId}`} onClose={onClose}>
      <div className="p-5 flex flex-col gap-6">

        {/* Calf ear tag — required */}
        <TextInput
          label="Calf ear tag"
          value={calfAnimalId}
          onChange={setCalfAnimalId}
          placeholder="e.g. T-2024-001"
          required
        />

        {/* Calf name — optional */}
        <TextInput
          label="Calf name (optional)"
          value={calfName}
          onChange={setCalfName}
          placeholder="e.g. Star"
        />

        <SegmentGroup
          label="Calf sex"
          value={calfSex}
          onChange={setCalfSex}
          options={[
            { value: "Female", label: "Female", icon: "🐄" },
            { value: "Male",   label: "Male",   icon: "🐂" },
          ]}
        />

        <SegmentGroup
          label="Calf alive?"
          value={calfAlive ? "yes" : "no"}
          onChange={(v) => setCalfAlive(v === "yes")}
          options={[
            { value: "yes", label: "Alive",     icon: "✅" },
            { value: "no",  label: "Stillborn", icon: "❌" },
          ]}
        />

        <SegmentGroup
          label="Ease of birth"
          value={ease}
          onChange={setEase}
          options={[
            { value: "Unassisted", label: "Unassisted", icon: "🟢" },
            { value: "Assisted",   label: "Assisted",   icon: "🟡" },
            { value: "Difficult",  label: "Difficult",  icon: "🔴" },
          ]}
        />

        {/* Date of birth */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>Date of birth</p>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333]"
            style={{
              backgroundColor: 'rgba(26, 13, 5, 0.6)',
              border: '1px solid rgba(92, 61, 46, 0.5)',
              color: '#F5F0E8',
              colorScheme: 'dark',
            }}
          />
        </div>

        {/* Father picker — only shown if bulls available */}
        {bulls.length > 0 && (
          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>Father (optional)</p>
            <select
              value={fatherId}
              onChange={(e) => setFatherId(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333]"
              style={{
                backgroundColor: 'rgba(26, 13, 5, 0.6)',
                border: '1px solid rgba(92, 61, 46, 0.5)',
                color: fatherId ? '#F5F0E8' : 'rgba(139,105,20,0.6)',
              }}
            >
              <option value="">Unknown / not recorded</option>
              {bulls.map((b) => (
                <option key={b.animalId} value={b.animalId}>
                  {b.animalId}{b.name ? ` — ${b.name}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Breed */}
        <TextInput
          label="Breed"
          value={breed}
          onChange={setBreed}
          placeholder="e.g. Brangus"
        />

        {/* Category */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>Category</p>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333]"
            style={{
              backgroundColor: 'rgba(26, 13, 5, 0.6)',
              border: '1px solid rgba(92, 61, 46, 0.5)',
              color: '#F5F0E8',
            }}
          >
            <option value="Calf">Calf</option>
            <option value="Heifer">Heifer</option>
            <option value="Bull Calf">Bull Calf</option>
          </select>
        </div>

        {/* Photo */}
        <PhotoCapture onPhotoCapture={(blob) => setPhotoBlob(blob)} />

        {/* Notes */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#D2B48C' }}>Notes (optional)</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Any additional information..."
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
          Record Birth
        </button>
      </div>
    </BottomSheet>
  );
}
