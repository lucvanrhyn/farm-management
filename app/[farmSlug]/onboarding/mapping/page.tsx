"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { MappingRow } from "@/components/onboarding/MappingRow";
import { UnmappedList } from "@/components/onboarding/UnmappedList";

/**
 * Mapping Confirmation page (wizard step 3 / B6).
 *
 * Reads the AI proposal from OnboardingProvider, lets the farmer review each
 * column-to-field guess with a confidence badge, adjust targets, ignore
 * columns, and manually rescue unmapped columns. Gates the Continue button
 * on two rules:
 *   1. every non-ignored row has a valid target
 *   2. at least one target equals `earTag`
 *
 * If the provider has no proposal (user hit this URL directly or cleared
 * session storage), we bounce back to /upload.
 */

// ---------------------------------------------------------------------------
// Target field catalog
// ---------------------------------------------------------------------------
//
// schema-dictionary.ts documents the Animal schema inside SYSTEM_PROMPT but
// does not export a typed array of field names. The set below is the union of
// what the system prompt tells the model it may emit and what commit-import's
// ImportRow accepts on insert. Keep this in sync with both.
//
// `__ignored__` is a synthetic option that maps to "drop this column".

type TargetField = {
  value: string;
  label: string;
  description?: string;
};

const TARGET_FIELDS: TargetField[] = [
  { value: "earTag", label: "Ear Tag (required)", description: "Primary animal ID" },
  { value: "sex", label: "Sex" },
  { value: "category", label: "Category" },
  { value: "breed", label: "Breed" },
  { value: "dateOfBirth", label: "Date of Birth" },
  { value: "motherId", label: "Mother / Dam Ear Tag" },
  { value: "fatherId", label: "Father / Sire Ear Tag" },
  { value: "sireNote", label: "Sire Note (free text)" },
  { value: "damNote", label: "Dam Note (free text)" },
  { value: "currentCamp", label: "Current Camp" },
  { value: "status", label: "Status" },
  { value: "species", label: "Species" },
  { value: "registrationNumber", label: "Registration Number" },
  { value: "deceasedAt", label: "Deceased Date" },
  { value: "notes", label: "Notes" },
];

const IGNORED_OPTION: TargetField = {
  value: "__ignored__",
  label: "— Ignore this column —",
};

const PLACEHOLDER_OPTION: TargetField = {
  value: "",
  label: "— Choose a target field —",
};

// Options shown inside MappingRow (sorted, prepended placeholder + Ignore).
const MAPPING_ROW_OPTIONS: TargetField[] = [
  PLACEHOLDER_OPTION,
  ...TARGET_FIELDS,
  IGNORED_OPTION,
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MappingPage() {
  const { farmSlug } = useParams<{ farmSlug: string }>();
  const router = useRouter();
  const { state, setMappingOverride, setUnmappedOverride } = useOnboarding();
  const { proposal, sampleRows, mappingOverrides, unmappedOverrides } = state;

  // Early-exit: no proposal means the user skipped /upload. Defer the redirect
  // to an effect so we don't mutate router during render.
  useEffect(() => {
    if (!proposal && farmSlug) {
      router.replace(`/${farmSlug}/onboarding/upload`);
    }
  }, [proposal, farmSlug, router]);

  // ---- Derived values ------------------------------------------------------

  const allRowsDecided = useMemo(() => {
    if (!proposal) return false;
    return proposal.proposal.mapping.every((m) => {
      const t = mappingOverrides[m.source] ?? m.target;
      return typeof t === "string" && t.length > 0;
    });
  }, [proposal, mappingOverrides]);

  const hasEarTag = useMemo(() => {
    if (!proposal) return false;
    const mappedTargets = proposal.proposal.mapping.map(
      (m) => mappingOverrides[m.source] ?? m.target,
    );
    const unmappedTargets = Object.values(unmappedOverrides).filter(
      (v) => typeof v === "string" && v.length > 0,
    );
    return [...mappedTargets, ...unmappedTargets].some((t) => t === "earTag");
  }, [proposal, mappingOverrides, unmappedOverrides]);

  const canContinue = allRowsDecided && hasEarTag;

  const continueBlockerMessage = useMemo(() => {
    if (!allRowsDecided) return "Assign a target to every column (or ignore it).";
    if (!hasEarTag) return "At least one column must map to Ear Tag before continuing.";
    return null;
  }, [allRowsDecided, hasEarTag]);

  // ---- Render guards -------------------------------------------------------

  if (!proposal) {
    // Redirect effect will fire; render a minimal placeholder in the meantime.
    return (
      <div
        className="mt-6 rounded-2xl p-8 text-center"
        style={{
          background: "#241C14",
          border: "1px solid rgba(196,144,48,0.18)",
          color: "#8A6840",
          fontFamily: "var(--font-sans)",
        }}
      >
        Loading mapping…
      </div>
    );
  }

  const warnings = proposal.proposal.warnings ?? [];
  const rowCount = proposal.proposal.row_count;
  const modelName = proposal.model;

  // ---- Render --------------------------------------------------------------

  return (
    <div className="mt-2 pb-28">
      {/* Heading */}
      <div className="mb-5">
        <h2
          className="text-xl md:text-2xl font-bold"
          style={{
            color: "#F0DEB8",
            fontFamily: "var(--font-display)",
          }}
        >
          Confirm your column mapping
        </h2>
        <p
          className="mt-1 text-sm"
          style={{ color: "#8A6840", fontFamily: "var(--font-sans)" }}
        >
          Our AI made its best guess. Review the confidence indicators and
          adjust anything that looks off.
        </p>
      </div>

      {/* AI metadata strip */}
      <div
        className="mb-5 text-[11px] flex flex-wrap gap-x-3 gap-y-1 items-center"
        style={{
          color: "#6A4E30",
          fontFamily: "var(--font-sans)",
          letterSpacing: "0.04em",
        }}
      >
        <span>AI model: {modelName}</span>
        <span aria-hidden="true">·</span>
        <span>{rowCount.toLocaleString()} rows detected</span>
        <span aria-hidden="true">·</span>
        <span>{proposal.proposal.mapping.length} columns mapped</span>
        {proposal.proposal.unmapped.length > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{proposal.proposal.unmapped.length} unmapped</span>
          </>
        ) : null}
      </div>

      {/* Warnings banner */}
      {warnings.length > 0 ? (
        <div
          className="mb-5 rounded-xl p-4"
          style={{
            background: "rgba(234,179,8,0.10)",
            border: "1px solid rgba(234,179,8,0.35)",
          }}
          role="status"
        >
          <div
            className="text-sm font-semibold mb-1 flex items-center gap-2"
            style={{ color: "#FACC15", fontFamily: "var(--font-sans)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Heads up
          </div>
          <ul
            className="list-disc pl-5 space-y-1 text-sm"
            style={{ color: "#F0DEB8", fontFamily: "var(--font-sans)" }}
          >
            {warnings.map((w, i) => (
              <li key={`${i}-${w.slice(0, 24)}`}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Mapped rows */}
      <section>
        <h3
          className="text-base font-semibold mb-3"
          style={{
            color: "#F0DEB8",
            fontFamily: "var(--font-display)",
          }}
        >
          Mapped columns
        </h3>

        <div className="flex flex-col gap-3">
          {proposal.proposal.mapping.map((m) => {
            const sampleValues = sampleRows
              .slice(0, 3)
              .map((r) => {
                const v = r[m.source];
                if (v === null || v === undefined) return "";
                return String(v);
              })
              .filter((v) => v.length > 0);

            const effectiveTarget =
              mappingOverrides[m.source] !== undefined
                ? mappingOverrides[m.source]
                : m.target;
            const ignored = effectiveTarget === "__ignored__";

            return (
              <MappingRow
                key={m.source}
                mapping={m}
                sampleValues={sampleValues}
                effectiveTarget={effectiveTarget}
                targetOptions={MAPPING_ROW_OPTIONS}
                onTargetChange={(t) => setMappingOverride(m.source, t)}
                onIgnore={() =>
                  setMappingOverride(m.source, ignored ? m.target : "__ignored__")
                }
                ignored={ignored}
              />
            );
          })}
        </div>
      </section>

      {/* Unmapped list */}
      <UnmappedList
        unmapped={proposal.proposal.unmapped}
        unmappedOverrides={unmappedOverrides}
        targetOptions={[...TARGET_FIELDS]}
        onAssign={(source, target) => setUnmappedOverride(source, target)}
      />

      {/* Sticky footer */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 px-5 py-4"
        style={{
          background: "linear-gradient(180deg, rgba(26,21,16,0) 0%, #1A1510 40%)",
        }}
      >
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          {!canContinue && continueBlockerMessage ? (
            <div
              className="text-xs text-center md:text-right"
              style={{ color: "#F87171", fontFamily: "var(--font-sans)" }}
            >
              {continueBlockerMessage}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/${farmSlug}/onboarding/upload`}
              className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm transition-colors"
              style={{
                background: "transparent",
                border: "1px solid rgba(196,144,48,0.4)",
                color: "#C49030",
                fontFamily: "var(--font-sans)",
              }}
            >
              ← Back
            </Link>
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => {
                if (canContinue && farmSlug) {
                  router.push(`/${farmSlug}/onboarding/import`);
                }
              }}
              className="inline-flex items-center justify-center rounded-md px-5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed"
              style={{
                background: canContinue ? "#C49030" : "#3A2A1A",
                color: canContinue ? "#1A1510" : "#6A4E30",
                border: canContinue
                  ? "1px solid #C49030"
                  : "1px solid #3A2A1A",
                fontFamily: "var(--font-sans)",
              }}
              aria-disabled={!canContinue}
            >
              Continue →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
