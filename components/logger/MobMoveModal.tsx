"use client";

import type { Camp } from "@/lib/types";
import ModalHeader from "@/components/ui/ModalHeader";

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
        style={{ backgroundColor: 'var(--ft-surface)', boxShadow: '0 -8px 40px rgba(0,0,0,0.6)' }}
      >
        <div className="flex justify-center">
          <div
            className="w-10 h-1.5 rounded-full"
            style={{ backgroundColor: 'var(--ft-border2)' }}
          />
        </div>
        <ModalHeader
          title={`Move Mob: ${mob.name}`}
          onClose={onClose}
          titleStyle={{ fontFamily: 'var(--ft-font-serif)', color: 'var(--ft-text)' }}
          closeStyle={{ color: 'var(--ft-muted)' }}
        />
        <p className="text-sm" style={{ color: 'var(--ft-muted)' }}>
          {mob.animal_count} animal{mob.animal_count !== 1 ? 's' : ''} will move together.
        </p>
        <select
          value={destCamp}
          onChange={(e) => onDestCampChange(e.target.value)}
          className="w-full py-3 px-4 rounded-xl text-sm"
          style={{
            backgroundColor: 'var(--ft-surface2)',
            border: '1px solid var(--ft-border)',
            color: 'var(--ft-muted)',
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
            backgroundColor: 'var(--ft-accent)',
            color: 'var(--ft-on-accent)',
          }}
        >
          {isSubmitting ? "Moving..." : "Confirm Move"}
        </button>
        <button
          onClick={onClose}
          className="text-sm py-2"
          style={{ color: 'var(--ft-muted)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
