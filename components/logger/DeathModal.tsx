"use client";

import { useState } from "react";
import StickySubmitBar from "@/components/logger/StickySubmitBar";

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
}

interface DeathModalProps {
  readonly isOpen: boolean;
  readonly animalId: string;
  readonly causes: string[];
  readonly onSubmit: (data: DeathSubmitData) => void;
  readonly onClose: () => void;
}

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

export default function DeathModal({
  isOpen,
  animalId,
  causes,
  onSubmit,
  onClose,
}: DeathModalProps) {
  const [selectedCause, setSelectedCause] = useState<string | null>(null);
  const [carcassDisposal, setCarcassDisposal] = useState<string>("");

  if (!isOpen) return null;

  const canSubmit = selectedCause !== null && carcassDisposal.length > 0;

  function handleSubmit() {
    // UX-layer guard. The server-side `validateDeathObservation` is the
    // authoritative backstop (422 DEATH_MULTI_CAUSE / DEATH_DISPOSAL_REQUIRED)
    // — the disabled `canSubmit` button is a usability courtesy.
    if (!selectedCause || !carcassDisposal) return;
    onSubmit({ cause: selectedCause, carcassDisposal });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-t-3xl p-6 flex flex-col gap-4 max-h-[88vh] overflow-y-auto"
        style={{ backgroundColor: "#1E0F07", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)" }}
      >
        <div className="flex justify-center">
          <div
            className="w-10 h-1.5 rounded-full"
            style={{ backgroundColor: "rgba(139, 105, 20, 0.4)" }}
          />
        </div>
        <h2
          className="font-bold text-lg"
          style={{ fontFamily: "var(--font-display)", color: "#F5F0E8" }}
        >
          Record Death — {animalId}
        </h2>
        <p className="text-sm" style={{ color: "#D2B48C" }}>
          Confirm that animal{" "}
          <span className="font-bold" style={{ color: "#F5F0E8" }}>
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
          style={{ color: "#D2B48C" }}
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
          style={{ color: "#D2B48C" }}
        >
          Carcass disposal
        </label>
        <select
          id="death-carcass-disposal"
          required
          value={carcassDisposal}
          onChange={(e) => setCarcassDisposal(e.target.value)}
          className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333]"
          style={{
            backgroundColor: "rgba(26, 13, 5, 0.6)",
            border: "1px solid rgba(92, 61, 46, 0.5)",
            color: "#F5F0E8",
          }}
        >
          <option value="">Select disposal method…</option>
          {DISPOSAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <StickySubmitBar className="-mx-6 px-6 mt-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full font-bold py-4 rounded-2xl text-base transition-opacity"
            style={{
              backgroundColor: "#B87333",
              color: "#F5F0E8",
              opacity: canSubmit ? 1 : 0.4,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            Record Death
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full text-sm py-2 mt-1"
            style={{ color: "rgba(210, 180, 140, 0.5)" }}
          >
            Cancel
          </button>
        </StickySubmitBar>
      </div>
    </div>
  );
}
