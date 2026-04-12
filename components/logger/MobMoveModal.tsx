"use client";

import type { Camp } from "@/lib/types";

interface MobInfo {
  readonly id: string;
  readonly name: string;
  readonly animal_count: number;
}

interface MobMoveModalProps {
  readonly isOpen: boolean;
  readonly mob: MobInfo | null;
  readonly camps: readonly Camp[];
  readonly currentCampId: string;
  readonly destCamp: string;
  readonly onDestCampChange: (campId: string) => void;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  readonly isSubmitting: boolean;
}

export default function MobMoveModal({
  isOpen,
  mob,
  camps,
  currentCampId,
  destCamp,
  onDestCampChange,
  onConfirm,
  onClose,
  isSubmitting,
}: MobMoveModalProps) {
  if (!isOpen || !mob) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-t-3xl p-6 flex flex-col gap-4"
        style={{ backgroundColor: '#1E0F07', boxShadow: '0 -8px 40px rgba(0,0,0,0.6)' }}
      >
        <div className="flex justify-center">
          <div
            className="w-10 h-1.5 rounded-full"
            style={{ backgroundColor: 'rgba(139, 105, 20, 0.4)' }}
          />
        </div>
        <h2
          className="font-bold text-lg"
          style={{ fontFamily: 'var(--font-display)', color: '#F5F0E8' }}
        >
          Move Mob: {mob.name}
        </h2>
        <p className="text-sm" style={{ color: '#D2B48C' }}>
          {mob.animal_count} animal{mob.animal_count !== 1 ? 's' : ''} will move together.
        </p>
        <select
          value={destCamp}
          onChange={(e) => onDestCampChange(e.target.value)}
          className="w-full py-3 px-4 rounded-xl text-sm"
          style={{
            backgroundColor: 'rgba(44, 21, 8, 0.5)',
            border: '1px solid rgba(92, 61, 46, 0.4)',
            color: '#D2B48C',
          }}
        >
          <option value="">Select destination camp...</option>
          {camps
            .filter((c) => c.camp_id !== currentCampId)
            .map((c) => (
              <option key={c.camp_id} value={c.camp_id}>
                {c.camp_name}
              </option>
            ))}
        </select>
        <button
          onClick={onConfirm}
          disabled={!destCamp || isSubmitting}
          className="w-full font-bold py-4 rounded-2xl text-sm transition-all active:scale-95 disabled:opacity-50"
          style={{
            backgroundColor: '#B87333',
            color: '#F5F0E8',
          }}
        >
          {isSubmitting ? "Moving..." : "Confirm Move"}
        </button>
        <button
          onClick={onClose}
          className="text-sm py-2"
          style={{ color: 'rgba(210, 180, 140, 0.5)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
