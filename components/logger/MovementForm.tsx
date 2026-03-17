"use client";

import { useState } from "react";
import { CAMPS } from "@/lib/dummy-data";

interface Props {
  animalId: string;
  sourceCampId: string;
  onClose: () => void;
  onSubmit?: (data: { animalId: string; sourceCampId: string; destCampId: string }) => void;
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

export default function MovementForm({ animalId, sourceCampId, onClose, onSubmit }: Props) {
  const [destCampId, setDestCampId] = useState("");
  const destinations = CAMPS.filter((c) => c.camp_id !== sourceCampId);

  function submit() {
    if (!destCampId) return;
    if (onSubmit) {
      onSubmit({ animalId, sourceCampId, destCampId });
    } else {
      alert(`Animal ${animalId} moved from ${sourceCampId} to ${destCampId}`);
      onClose();
    }
  }

  return (
    <BottomSheet title={`Move Animal — ${animalId}`} onClose={onClose}>
      <div className="p-5 flex flex-col gap-6">
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(44, 21, 8, 0.5)',
            color: '#D2B48C',
            border: '1px solid rgba(92, 61, 46, 0.3)',
          }}
        >
          Current camp: <span className="font-bold" style={{ color: '#F5F0E8' }}>{sourceCampId}</span>
        </div>

        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: '#D2B48C' }}>Move to camp</p>
          <div className="grid grid-cols-3 gap-2">
            {destinations.map((camp) => (
              <button
                key={camp.camp_id}
                onClick={() => setDestCampId(camp.camp_id)}
                className="px-3 py-3 rounded-xl text-sm font-semibold transition-colors"
                style={
                  destCampId === camp.camp_id
                    ? { border: '2px solid #B87333', backgroundColor: 'rgba(184,115,51,0.2)', color: '#F5F0E8' }
                    : { border: '1px solid rgba(92, 61, 46, 0.4)', backgroundColor: 'rgba(44, 21, 8, 0.5)', color: '#D2B48C' }
                }
              >
                {camp.camp_name}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!destCampId}
          className="w-full font-bold py-4 rounded-2xl text-base transition-colors"
          style={
            !destCampId
              ? { backgroundColor: 'rgba(92, 61, 46, 0.3)', color: '#D2B48C' }
              : { backgroundColor: '#B87333', color: '#F5F0E8' }
          }
        >
          Confirm Move
        </button>
      </div>
    </BottomSheet>
  );
}
