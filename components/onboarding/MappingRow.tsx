"use client";

import type { ProposalResult } from "@/lib/onboarding/client-types";
import { ConfidenceBadge } from "./ConfidenceBadge";

type ProposalMapping = ProposalResult["proposal"]["mapping"][number];

type Props = {
  mapping: ProposalMapping;
  /** Up to 3 sample values from the source column. */
  sampleValues: string[];
  /** The currently-effective target — from overrides if present, else mapping.target. */
  effectiveTarget: string;
  targetOptions: Array<{ value: string; label: string }>;
  onTargetChange: (target: string) => void;
  onIgnore: () => void;
  ignored: boolean;
};

/**
 * MappingRow — renders one AI-proposed column mapping for confirmation.
 *
 * Layout (dark amber theme):
 *   left   : source column name + sample values
 *   middle : editable target <select>
 *   right  : confidence pill + Ignore toggle
 *   below  : transform hint, fuzzy_matches, approximate warning (when present)
 *
 * Ignored rows render with reduced opacity and strike-through on the source
 * name so the farmer can see at a glance which columns they've dropped.
 */
export function MappingRow({
  mapping,
  sampleValues,
  effectiveTarget,
  targetOptions,
  onTargetChange,
  onIgnore,
  ignored,
}: Props) {
  const samples = sampleValues.slice(0, 3).map((s) =>
    s.length > 28 ? `${s.slice(0, 25)}...` : s,
  );

  return (
    <div
      className="rounded-xl p-4 transition-opacity"
      style={{
        background: "#241C14",
        border: "1px solid rgba(196,144,48,0.18)",
        opacity: ignored ? 0.5 : 1,
      }}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
        {/* Left: source column + samples */}
        <div className="flex-1 min-w-0">
          <div
            className="font-semibold text-sm"
            style={{
              color: "#F0DEB8",
              fontFamily: "var(--font-sans)",
              textDecoration: ignored ? "line-through" : "none",
            }}
          >
            {mapping.source}
          </div>
          {samples.length > 0 ? (
            <div
              className="mt-1 text-xs"
              style={{
                color: "#8A6840",
                fontFamily: "var(--font-sans)",
              }}
            >
              e.g. {samples.map((v) => `"${v}"`).join(", ")}
            </div>
          ) : (
            <div
              className="mt-1 text-xs italic"
              style={{ color: "#6A4E30" }}
            >
              (no sample values)
            </div>
          )}
        </div>

        {/* Middle: target select */}
        <div className="flex-1 min-w-0 md:max-w-xs">
          <label
            className="block text-[11px] uppercase tracking-wider mb-1"
            style={{ color: "#6A4E30", fontFamily: "var(--font-sans)" }}
          >
            Maps to
          </label>
          <div className="relative">
            <select
              value={effectiveTarget}
              disabled={ignored}
              onChange={(e) => onTargetChange(e.target.value)}
              className="w-full rounded-md px-3 py-2 pr-8 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed"
              style={{
                background: "#1A1510",
                border: "1px solid rgba(196,144,48,0.28)",
                color: "#F0DEB8",
                fontFamily: "var(--font-sans)",
              }}
              aria-label={`Target field for ${mapping.source}`}
            >
              {targetOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {/* Pencil icon indicating editable */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: "#8A6840" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
            </span>
          </div>
        </div>

        {/* Right: confidence + ignore toggle */}
        <div className="flex md:flex-col md:items-end items-center gap-2 shrink-0">
          <ConfidenceBadge confidence={mapping.confidence} />
          <button
            type="button"
            onClick={onIgnore}
            className="text-xs underline underline-offset-2 transition-colors"
            style={{ color: ignored ? "#C49030" : "#8A6840" }}
            aria-pressed={ignored}
          >
            {ignored ? "Un-ignore" : "Ignore"}
          </button>
        </div>
      </div>

      {/* Extra hints below the row */}
      {(mapping.transform ||
        (mapping.fuzzy_matches && mapping.fuzzy_matches.length > 0) ||
        mapping.approximate) && (
        <div className="mt-3 flex flex-col gap-1.5 pl-0.5">
          {mapping.transform ? (
            <div
              className="text-xs"
              style={{ color: "#6A4E30", fontFamily: "var(--font-sans)" }}
            >
              <span
                className="uppercase tracking-wider mr-2 text-[10px]"
                style={{ color: "#8A6840" }}
              >
                Transform
              </span>
              {mapping.transform}
            </div>
          ) : null}

          {mapping.fuzzy_matches && mapping.fuzzy_matches.length > 0 ? (
            <div
              className="text-xs flex flex-wrap gap-1.5 items-center"
              style={{ color: "#8A6840" }}
            >
              <span
                className="uppercase tracking-wider text-[10px]"
                style={{ color: "#8A6840" }}
              >
                Fuzzy matches
              </span>
              {mapping.fuzzy_matches.map((fm) => (
                <span
                  key={`${fm.source_value}->${fm.camp_id}`}
                  className="rounded px-1.5 py-0.5"
                  style={{
                    background: "rgba(196,144,48,0.08)",
                    border: "1px solid rgba(196,144,48,0.2)",
                    color: "#F0DEB8",
                  }}
                >
                  {fm.source_value} → {fm.camp_id}
                </span>
              ))}
            </div>
          ) : null}

          {mapping.approximate ? (
            <div
              className="text-xs inline-flex items-center gap-1.5 rounded px-2 py-0.5 w-fit"
              style={{
                background: "rgba(234,179,8,0.12)",
                border: "1px solid rgba(234,179,8,0.3)",
                color: "#F0DEB8",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Approximate values — dates may be imprecise
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
