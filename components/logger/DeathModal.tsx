"use client";

import { useRef, useState } from "react";
import StickySubmitBar from "@/components/logger/StickySubmitBar";
import ModalHeader from "@/components/ui/ModalHeader";

/**
 * Wave 3b / #254 (PRD #250) — Death modal: single-cause radio + required
 * carcassDisposal <select>.
 *
 * Bug class fix:
 *   The pre-#254 modal was a tap-to-submit cause picker with no disposal
 *   field. SARS / NSPCA conventions require carcass-disposal capture for
 *   every death event; the absence was a regulatory gap. The HITL-locked
 *   disposal enum is {BURIED, BURNED, RENDERED, OTHER} (see
 *   `lib/server/validators/death.ts` :: CARCASS_DISPOSAL_VALUES — the
 *   server-side validator and migration mirror this list verbatim).
 *
 * UX layer of the defense-in-depth:
 *   - Cause: a single `role="radiogroup"` with one `role="radio"` per
 *     cause. The single-select invariant is structurally guaranteed.
 *   - Disposal: a required `<select>` whose options are the locked enum.
 *   - Submit: blocked until BOTH fields have a value (no submit fires
 *     onSubmit until the joint payload is valid).
 *
 * The server-side `validateDeathObservation` is the second layer — even a
 * stale or malicious client cannot bypass either rule (422 DEATH_MULTI_CAUSE
 * / 422 DEATH_DISPOSAL_REQUIRED). Mirrors the PRD #253 defense pattern.
 */

const DISPOSAL_OPTIONS = [
  { value: "BURIED", label: "Buried" },
  { value: "BURNED", label: "Burned" },
  { value: "RENDERED", label: "Rendered" },
  { value: "OTHER", label: "Other" },
] as const;

export interface DeathSubmitData {
  cause: string;
  carcassDisposal: string;
  /**
   * Issue #492 (PRD #479 backlog) — optional first-class free-text note (Path
   * A). Persisted onto the `Observation.notes` column (NOT the `details` JSON).
   */
  notes: string;
}

interface DeathModalProps {
  readonly isOpen: boolean;
  readonly animalId: string;
  readonly causes: string[];
  // S6 / OS-3 — widened to accept a promise so the in-flight latch can hold
  // until the parent's async queue write settles. The Logger page handler is
  // an async function; the old `void` signature silently dropped its promise.
  readonly onSubmit: (data: DeathSubmitData) => void | Promise<void>;
  readonly onClose: () => void;
}

const SELECTED_STYLE = {
  border: "2px solid var(--ft-accent)",
  backgroundColor: "var(--ft-accent-faint)",
  color: "var(--ft-text)",
};
const DEFAULT_STYLE = {
  border: "1px solid var(--ft-border)",
  backgroundColor: "var(--ft-surface2)",
  color: "var(--ft-muted)",
};

export default function DeathModal({
  isOpen,
  animalId,
  causes,
  onSubmit,
  onClose,
}: DeathModalProps) {
  const [selectedCause, setSelectedCause] = useState<string | null>(null);
  const [carcassDisposal, setCarcassDisposal] = useState<string>("");
  // Issue #492 — optional free-text note on the death event.
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // S6 / OS-3 (#482 WeighingForm pattern) — synchronous in-flight latch. This
  // modal had NO submit guard at all: a double-tap fired `onSubmit` twice and
  // each enqueue mints its own clientLocalId → two death observations. The ref
  // is set synchronously BEFORE any await so the same-tick second tap is
  // swallowed; `submitting` state covers the cross-render window; reset in
  // `finally` so a legitimate later submit works after success OR failure.
  const inFlightRef = useRef(false);

  if (!isOpen) return null;

  const canSubmit = selectedCause !== null && carcassDisposal.length > 0 && !submitting;

  async function handleSubmit() {
    // UX-layer guard. The server-side `validateDeathObservation` is the
    // authoritative backstop (422 DEATH_MULTI_CAUSE / DEATH_DISPOSAL_REQUIRED)
    // — the disabled `canSubmit` button is a usability courtesy.
    if (inFlightRef.current) return;
    if (!selectedCause || !carcassDisposal) return;

    inFlightRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({ cause: selectedCause, carcassDisposal, notes });
    } catch {
      setError("Failed to queue — try again");
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-t-3xl p-6 flex flex-col gap-4 max-h-[88vh] overflow-y-auto"
        style={{ backgroundColor: "var(--ft-surface)", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)" }}
      >
        <div className="flex justify-center">
          <div
            className="w-10 h-1.5 rounded-full"
            style={{ backgroundColor: "var(--ft-border2)" }}
          />
        </div>
        <ModalHeader
          title={`Record Death — ${animalId}`}
          onClose={onClose}
          titleStyle={{ fontFamily: "var(--ft-font-serif)", color: "var(--ft-text)" }}
          closeStyle={{ color: "var(--ft-muted)" }}
        />
        <p className="text-sm" style={{ color: "var(--ft-muted)" }}>
          Confirm that animal{" "}
          <span className="font-bold" style={{ color: "var(--ft-text)" }}>
            {animalId}
          </span>{" "}
          is deceased.
        </p>

        {/*
          Single-cause radio. The structural single-select role is what
          guarantees the multi-cause silent-data-loss path cannot be
          re-introduced at the UX layer (see `__tests__/components/death-form-radio.test.tsx`).
          Server-side `validateDeathObservation` is the second backstop.
        */}
        <p
          className="text-sm font-semibold"
          id="death-cause-label"
          style={{ color: "var(--ft-muted)" }}
        >
          Cause of death
        </p>
        <div
          role="radiogroup"
          aria-labelledby="death-cause-label"
          className="flex flex-col gap-2"
        >
          {causes.map((cause) => (
            <button
              key={cause}
              type="button"
              role="radio"
              aria-checked={selectedCause === cause}
              onClick={() => setSelectedCause(cause)}
              className="w-full text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-colors"
              style={selectedCause === cause ? SELECTED_STYLE : DEFAULT_STYLE}
            >
              {cause}
            </button>
          ))}
        </div>

        {/*
          Required carcass-disposal <select>. The four options match the
          HITL-locked enum in `lib/server/validators/death.ts` ::
          CARCASS_DISPOSAL_VALUES, which the migration also mirrors verbatim.
          Empty `""` placeholder option is the unselected sentinel — the
          submit gate rejects it.
        */}
        <label
          htmlFor="death-carcass-disposal"
          className="text-sm font-semibold"
          style={{ color: "var(--ft-muted)" }}
        >
          Carcass disposal
        </label>
        <select
          id="death-carcass-disposal"
          required
          value={carcassDisposal}
          onChange={(e) => setCarcassDisposal(e.target.value)}
          className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-accent)]"
          style={{
            backgroundColor: "var(--ft-surface2)",
            border: "1px solid var(--ft-border2)",
            color: "var(--ft-text)",
          }}
        >
          <option value="">Select disposal method…</option>
          {DISPOSAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Issue #492 — optional free-text note on the death event (e.g.
            "found in north camp, no predator signs"). Persisted to the
            first-class `notes` column, not the structured details. */}
        <label
          htmlFor="death-notes"
          className="text-sm font-semibold"
          style={{ color: "var(--ft-muted)" }}
        >
          Notes (optional)
        </label>
        <textarea
          id="death-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="e.g. found in north camp, no predator signs"
          className="w-full rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--ft-accent)]"
          style={{
            backgroundColor: "var(--ft-surface2)",
            border: "1px solid var(--ft-border2)",
            color: "var(--ft-text)",
          }}
        />

        {error && (
          <p className="text-sm text-center" style={{ color: "var(--ft-poor)" }}>{error}</p>
        )}

        <StickySubmitBar className="-mx-6 px-6 mt-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full font-bold py-4 rounded-2xl text-base transition-opacity"
            style={{
              backgroundColor: "var(--ft-accent)",
              color: "var(--ft-on-accent)",
              opacity: canSubmit ? 1 : 0.4,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "Saving..." : "Record Death"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full text-sm py-2 mt-1"
            style={{ color: "var(--ft-muted)" }}
          >
            Cancel
          </button>
        </StickySubmitBar>
      </div>
    </div>
  );
}
