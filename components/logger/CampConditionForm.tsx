"use client";

import { useEffect, useState } from "react";
import type { GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";
import { PhotoCapture } from "@/components/logger/PhotoCapture";

interface Props {
  campId: string;
  onClose: () => void;
  onSkip?: () => void;
  onSubmit?: (data: {
    campId: string;
    grazing: GrazingQuality;
    water: WaterStatus;
    fence: FenceStatus;
    photoBlob: Blob | null;
    /**
     * Issue #206 — mount-stable idempotency key. The Logger page persists this
     * onto the queued observation; offline-sync replays it verbatim; the
     * server upserts on `(clientLocalId)` so a retry returns the original row
     * instead of creating a duplicate.
     */
    clientLocalId: string;
  }) => void;
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Lock body scroll while the bottom-sheet is mounted to prevent
  // touch-drag on the page behind the modal (frustrates data entry on iOS).
  // Restore the previous value on unmount so we don't clobber other modals'
  // overflow state.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        // max-h-[88dvh] (dynamic viewport height) shrinks correctly when
        // iOS Safari's URL bar appears. The previous `88vh` was locked to
        // the largest viewport, pushing Submit off-screen with the toolbar.
        className="relative rounded-t-3xl max-h-[88dvh] flex flex-col shadow-2xl"
        style={{ backgroundColor: 'var(--ft-surface)' }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full" style={{ backgroundColor: 'var(--ft-border2)' }} />
        </div>
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
        {/* Bottom padding adds env(safe-area-inset-bottom) so Submit/Skip
            clear the iPhone home indicator. Inline style is required —
            Tailwind v4 doesn't ship a built-in pb-[env(...)] utility and the
            project hasn't registered a `pb-safe` arbitrary variant globally. */}
        <div
          className="overflow-y-auto flex-1"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

type StatusTone = "good" | "fair" | "poor" | "crit" | "info";
type OptionCard<T> = { value: T; label: string; icon: string; tone: StatusTone };

/**
 * Selected status-card styling — mirrors the design handoff's status pattern
 * (loggercamp.jsx: tinted background `color-mix(status 18%, surface)` + status
 * text) using the --ft status tokens, so the selected card adapts to the light
 * "paper" logger surface instead of the old dark-mode Tailwind swatches.
 */
function selectedToneStyle(tone: StatusTone): React.CSSProperties {
  const c = `var(--ft-${tone})`;
  return {
    border: `1px solid ${c}`,
    backgroundColor: `color-mix(in oklab, ${c} 18%, var(--ft-surface))`,
    color: c,
  };
}

function CardGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: OptionCard<T>[];
  /**
   * Issue #321 — `null` means "not yet answered". The pre-#321 form
   * defaulted this to a real value ("Good"/"Full"/"Intact"), so an
   * untouched group looked answered. Selection cards now render in the
   * neutral (unselected) style until the farmer explicitly picks one.
   */
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold mb-3" style={{ color: 'var(--ft-muted)' }}>{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-medium transition-colors"
            style={
              value === opt.value
                ? selectedToneStyle(opt.tone)
                : { border: '1px solid var(--ft-border)', backgroundColor: 'var(--ft-surface2)', color: 'var(--ft-muted)' }
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
  { value: "Good",       label: "Good",       icon: "🟢", tone: "good" },
  { value: "Fair",       label: "Fair",       icon: "🟡", tone: "fair" },
  { value: "Poor",       label: "Poor",       icon: "🟠", tone: "poor" },
  { value: "Overgrazed", label: "Overgrazed", icon: "🔴", tone: "crit" },
];

const WATER_OPTIONS: OptionCard<WaterStatus>[] = [
  { value: "Full",   label: "Full",   icon: "💧", tone: "info" },
  { value: "Low",    label: "Low",    icon: "🔵", tone: "info" },
  { value: "Empty",  label: "Empty",  icon: "⚠️", tone: "fair" },
  { value: "Broken", label: "Broken", icon: "🔧", tone: "crit" },
];

const FENCE_OPTIONS: OptionCard<FenceStatus>[] = [
  { value: "Intact",  label: "Intact",  icon: "✅", tone: "good" },
  { value: "Damaged", label: "Damaged", icon: "⚠️", tone: "crit" },
];

export default function CampConditionForm({ campId, onClose, onSkip, onSubmit }: Props) {
  // Issue #321 — start every selection unanswered. The pre-#321 defaults
  // ("Good"/"Full"/"Intact") were used as BOTH placeholders and answers, so
  // a zero-interaction (or stale-offline) submit recorded a clean inspection
  // indistinguishable from a deliberate all-good one. `null` sentinels +
  // a disabled Submit force an explicit choice for each field.
  const [grazing, setGrazing] = useState<GrazingQuality | null>(null);
  const [water, setWater] = useState<WaterStatus | null>(null);
  const [fence, setFence] = useState<FenceStatus | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  // Issue #206 — mount-stable idempotency key. `useState(() => …)` runs the
  // initializer exactly once per mount, so accidental double-clicks (or any
  // re-render) reuse the same UUID. The server upserts on this key, collapsing
  // duplicate POSTs to a single row. A fresh mount (new modal open, browser
  // reload) gets a fresh UUID — each logging session is its own write.
  const [clientLocalId] = useState<string>(() => crypto.randomUUID());

  // Issue #321 — every field must be explicitly answered before the report
  // can be submitted. This gates the button structurally (not via a
  // post-click `alert()`), so a stale client can't enqueue an implicit
  // all-default reading offline.
  const isComplete = grazing !== null && water !== null && fence !== null;

  function submit() {
    if (grazing === null || water === null || fence === null) return;
    if (onSubmit) {
      onSubmit({ campId, grazing, water, fence, photoBlob, clientLocalId });
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

        <PhotoCapture onPhotoCapture={(blob) => setPhotoBlob(blob)} />

        <button
          onClick={submit}
          disabled={!isComplete}
          className="w-full font-bold py-4 rounded-2xl text-base transition-colors disabled:cursor-not-allowed"
          style={
            isComplete
              ? { backgroundColor: 'var(--ft-accent)', color: 'var(--ft-on-accent)' }
              : { backgroundColor: 'var(--ft-accent-faint)', color: 'var(--ft-muted)' }
          }
        >
          Submit Camp Report
        </button>

        {onSkip && (
          <button
            onClick={onSkip}
            className="w-full py-3 text-sm font-medium transition-colors rounded-2xl active:scale-95"
            style={{
              color: 'var(--ft-muted)',
              backgroundColor: 'var(--ft-surface2)',
              border: '1px solid var(--ft-border)',
            }}
          >
            Skip for now →
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
