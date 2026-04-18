"use client";

import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { MappingRow } from "@/components/onboarding/MappingRow";
import { UnmappedList } from "@/components/onboarding/UnmappedList";
import { StepShell } from "@/components/onboarding/StepShell";
import {
  ONBOARDING_COLORS,
  SPRING_SOFT,
  staggerContainer,
} from "@/components/onboarding/theme";

/**
 * Mapping Confirmation page (wizard step 3 / B6).
 *
 * Reads the AI proposal from OnboardingProvider, lets the farmer review each
 * column-to-field guess with a confidence badge, adjust targets, ignore
 * columns, and manually rescue unmapped columns. Gates the Continue button
 * on two rules:
 *   1. every non-ignored row has a valid target
 *   2. at least one target equals `earTag`
 */

type TargetField = { value: string; label: string; description?: string };

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
const MAPPING_ROW_OPTIONS: TargetField[] = [
  PLACEHOLDER_OPTION,
  ...TARGET_FIELDS,
  IGNORED_OPTION,
];

export default function MappingPage() {
  const { farmSlug } = useParams<{ farmSlug: string }>();
  const router = useRouter();
  const { state, setMappingOverride, setUnmappedOverride } = useOnboarding();
  const { proposal, sampleRows, mappingOverrides, unmappedOverrides } = state;

  // Early-exit: no proposal → back to /upload
  useEffect(() => {
    if (!proposal && farmSlug) {
      router.replace(`/${farmSlug}/onboarding/upload`);
    }
  }, [proposal, farmSlug, router]);

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

  if (!proposal) {
    return (
      <div
        className="mt-6 rounded-[1.5rem] p-8 text-center"
        style={{
          background: "rgba(36,28,20,0.85)",
          border: "1px solid rgba(196,144,48,0.18)",
          color: ONBOARDING_COLORS.mutedDim,
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

  return (
    <StepShell
      eyebrow="Step 03 · Mapping"
      title={
        <>
          Confirm the AI&apos;s{" "}
          <span
            className="italic"
            style={{
              fontFamily: "var(--font-dm-serif)",
              color: ONBOARDING_COLORS.amberBright,
            }}
          >
            reading
          </span>
          .
        </>
      }
      lead={
        <>
          Green bands are auto-safe, amber deserve a glance, rust need a decision.
          Adjust anything that looks off — nothing is saved until you commit on
          the next step.
        </>
      }
    >
      {/* Receipt metadata */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_SOFT}
        className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border px-3.5 py-1.5 text-[11px] w-fit"
        style={{
          borderColor: "rgba(196,144,48,0.25)",
          background: "rgba(20,16,11,0.75)",
          color: ONBOARDING_COLORS.muted,
          fontFamily: "var(--font-mono, ui-monospace)",
          letterSpacing: "0.04em",
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          <Sparkles size={11} strokeWidth={2} className="text-amber-300" />
          {modelName}
        </span>
        <span aria-hidden="true">·</span>
        <span>{rowCount.toLocaleString()} rows</span>
        <span aria-hidden="true">·</span>
        <span>{proposal.proposal.mapping.length} mapped</span>
        {proposal.proposal.unmapped.length > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{proposal.proposal.unmapped.length} unmapped</span>
          </>
        ) : null}
      </motion.div>

      {/* Warnings */}
      {warnings.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING_SOFT}
          role="status"
          className="mb-6 flex gap-3 rounded-xl p-4"
          style={{
            background:
              "linear-gradient(180deg, rgba(217,164,65,0.10) 0%, rgba(36,28,20,0.85) 100%)",
            border: "1px solid rgba(217,164,65,0.35)",
          }}
        >
          <AlertTriangle
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            style={{ color: "#E5B964", flexShrink: 0, marginTop: 2 }}
          />
          <div className="flex-1">
            <p
              className="mb-1 text-[12.5px] font-semibold"
              style={{
                color: "#F5EBD4",
                fontFamily: "var(--font-sans)",
                letterSpacing: "0.01em",
              }}
            >
              Heads up
            </p>
            <ul
              className="list-disc space-y-1 pl-4 text-[12.5px]"
              style={{ color: ONBOARDING_COLORS.muted, fontFamily: "var(--font-sans)" }}
            >
              {warnings.map((w, i) => (
                <li key={`${i}-${w.slice(0, 24)}`}>{w}</li>
              ))}
            </ul>
          </div>
        </motion.div>
      ) : null}

      {/* Mapped columns */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h3
            className="text-[1rem] font-semibold"
            style={{
              color: ONBOARDING_COLORS.cream,
              fontFamily: "var(--font-display)",
              letterSpacing: "-0.005em",
            }}
          >
            Mapped columns
          </h3>
          <span
            className="text-[11px]"
            style={{ color: ONBOARDING_COLORS.whisper, fontFamily: "var(--font-sans)" }}
          >
            · {proposal.proposal.mapping.length}
          </span>
        </div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-3"
        >
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
        </motion.div>
      </section>

      <UnmappedList
        unmapped={proposal.proposal.unmapped}
        unmappedOverrides={unmappedOverrides}
        targetOptions={[...TARGET_FIELDS]}
        onAssign={(source, target) => setUnmappedOverride(source, target)}
      />

      {/* Sticky footer — backdrop-blur over the page content */}
      <div className="pb-28" aria-hidden="true" />
      <div
        className="fixed inset-x-0 bottom-0 z-20 px-4 pb-5 pt-12"
        style={{
          background:
            "linear-gradient(180deg, rgba(20,16,11,0) 0%, rgba(20,16,11,0.78) 35%, #14100B 100%)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        <div className="mx-auto max-w-3xl">
          {!canContinue && continueBlockerMessage ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-2 text-right text-[11.5px]"
              style={{ color: "#E88C78", fontFamily: "var(--font-sans)" }}
            >
              {continueBlockerMessage}
            </motion.div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => farmSlug && router.push(`/${farmSlug}/onboarding/upload`)}
              className="group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors"
              style={{
                background: "transparent",
                border: "1px solid rgba(196,144,48,0.4)",
                color: ONBOARDING_COLORS.parchment,
                fontFamily: "var(--font-sans)",
              }}
            >
              <ArrowLeft
                size={13}
                strokeWidth={2}
                className="transition-transform group-hover:-translate-x-0.5"
              />
              Back
            </button>
            <motion.button
              type="button"
              disabled={!canContinue}
              onClick={() => {
                if (canContinue && farmSlug) {
                  router.push(`/${farmSlug}/onboarding/import`);
                }
              }}
              whileHover={canContinue ? { y: -2 } : undefined}
              whileTap={canContinue ? { scale: 0.97 } : undefined}
              transition={SPRING_SOFT}
              className="group inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1A1510] focus-visible:ring-amber-400 disabled:cursor-not-allowed"
              style={{
                background: canContinue
                  ? "linear-gradient(135deg, rgba(229,185,100,0.95) 0%, rgba(196,144,48,0.95) 45%, rgba(160,82,45,0.95) 100%)"
                  : "rgba(58,42,26,0.6)",
                color: canContinue ? "#1A1510" : ONBOARDING_COLORS.whisper,
                border: canContinue
                  ? "1px solid rgba(229,185,100,0.5)"
                  : "1px solid rgba(58,42,26,0.8)",
                boxShadow: canContinue
                  ? "0 10px 28px rgba(196,144,48,0.35), 0 1px 0 rgba(245,235,212,0.25) inset"
                  : "none",
                fontFamily: "var(--font-sans)",
              }}
              aria-disabled={!canContinue}
            >
              Continue to import
              <ArrowRight
                size={15}
                strokeWidth={2.5}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </motion.button>
          </div>
        </div>
      </div>
    </StepShell>
  );
}
