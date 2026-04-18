"use client";

/**
 * Step 5 — import summary.
 *
 * Celebratory reveal. Three stacked DisplayCards summarize inserted / skipped
 * / error counts. Tiny amber particles drift up behind the cards for a
 * Polaroid-developing feel. Direct-URL visits without a result redirect back
 * to welcome once the Provider has hydrated.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  MinusCircle,
  PlusCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { StepShell } from "@/components/onboarding/StepShell";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import {
  ONBOARDING_COLORS,
  SPRING_SOFT,
  staggerContainer,
} from "@/components/onboarding/theme";

const MAX_VISIBLE_ERRORS = 10;

export default function OnboardingDonePage() {
  const router = useRouter();
  const params = useParams<{ farmSlug: string }>();
  const farmSlug = params.farmSlug;
  const { state, reset } = useOnboarding();
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const result = state.result;

  useEffect(() => {
    const handle = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    if (!hydrated || result || !farmSlug) return;
    router.replace(`/${farmSlug}/onboarding`);
  }, [hydrated, result, farmSlug, router]);

  const visibleErrors = useMemo(() => {
    if (!result) return [];
    return showAllErrors
      ? result.errors
      : result.errors.slice(0, MAX_VISIBLE_ERRORS);
  }, [result, showAllErrors]);

  if (!result) {
    return null;
  }

  function goToAdmin() {
    if (!farmSlug) return;
    reset();
    router.push(`/${farmSlug}/admin`);
  }

  function importMore() {
    if (!farmSlug) return;
    reset();
    router.push(`/${farmSlug}/onboarding/upload`);
  }

  const hasErrors = result.errors.length > 0;

  return (
    <StepShell
      eyebrow="Step 05 · Welcome aboard"
      title={
        <>
          Your ledger is{" "}
          <span
            className="italic"
            style={{
              fontFamily: "var(--font-dm-serif)",
              color: ONBOARDING_COLORS.amberBright,
            }}
          >
            alive
          </span>
          .
        </>
      }
      lead={
        hasErrors ? (
          <>
            Most rows landed safely. A few need your attention — expand the
            list below to see exactly which ones and why.
          </>
        ) : (
          <>
            Every row landed safely. Your herd is now live in FarmTrack —
            jump into admin to explore what we imported.
          </>
        )
      }
    >
      {/* Ambient amber particles drifting up */}
      <EmberField />

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="relative grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4"
      >
        <StatCard
          label="Imported"
          value={result.inserted}
          tone="success"
          icon={PlusCircle}
        />
        <StatCard
          label="Skipped"
          value={result.skipped}
          tone="neutral"
          icon={MinusCircle}
        />
        <StatCard
          label="Errors"
          value={result.errors.length}
          tone={hasErrors ? "warning" : "neutral"}
          icon={hasErrors ? AlertTriangle : CheckCircle2}
        />
      </motion.div>

      {hasErrors ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_SOFT, delay: 0.3 }}
          className="mt-8 flex flex-col gap-2"
        >
          <p
            className="text-[0.9rem] font-semibold"
            style={{
              color: ONBOARDING_COLORS.cream,
              fontFamily: "var(--font-display)",
            }}
          >
            Rows that couldn&apos;t be imported
          </p>
          <ul
            className="flex flex-col divide-y divide-[rgba(140,100,60,0.16)] overflow-hidden rounded-2xl"
            style={{
              background: "rgba(20,16,11,0.7)",
              border: "1px solid rgba(140,100,60,0.22)",
            }}
          >
            {visibleErrors.map((err, idx) => (
              <li
                key={`${err.row}-${idx}`}
                className="flex items-start gap-3 px-4 py-2.5"
              >
                <span
                  className="min-w-[3.5rem] text-[11px] tracking-wider"
                  style={{
                    color: ONBOARDING_COLORS.whisper,
                    fontFamily: "var(--font-mono, ui-monospace)",
                  }}
                >
                  Row {err.row}
                </span>
                {err.earTag ? (
                  <span
                    className="min-w-[5rem] text-[11.5px]"
                    style={{
                      color: ONBOARDING_COLORS.muted,
                      fontFamily: "var(--font-mono, ui-monospace)",
                    }}
                  >
                    {err.earTag}
                  </span>
                ) : null}
                <span
                  className="text-[12.5px]"
                  style={{
                    color: "#F5C2B5",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {err.reason}
                </span>
              </li>
            ))}
          </ul>
          {!showAllErrors && result.errors.length > MAX_VISIBLE_ERRORS ? (
            <button
              type="button"
              onClick={() => setShowAllErrors(true)}
              className="self-start text-[12px] underline underline-offset-4"
              style={{
                color: ONBOARDING_COLORS.amberBright,
                fontFamily: "var(--font-sans)",
              }}
            >
              Show {result.errors.length - MAX_VISIBLE_ERRORS} more
            </button>
          ) : null}
        </motion.div>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_SOFT, delay: 0.45 }}
        className="mt-8 flex flex-wrap items-center justify-between gap-4"
      >
        <button
          type="button"
          onClick={goToAdmin}
          className="group inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1A1510] focus-visible:ring-amber-400"
          style={{
            background:
              "linear-gradient(135deg, rgba(229,185,100,0.95) 0%, rgba(196,144,48,0.95) 45%, rgba(160,82,45,0.95) 100%)",
            color: "#1A1510",
            boxShadow:
              "0 10px 30px rgba(196,144,48,0.35), 0 1px 0 rgba(245,235,212,0.25) inset",
            fontFamily: "var(--font-sans)",
          }}
        >
          Go to Admin
          <ArrowRight
            size={15}
            strokeWidth={2.5}
            className="transition-transform group-hover:translate-x-1"
          />
        </button>
        <button
          type="button"
          onClick={importMore}
          className="inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
          style={{
            color: ONBOARDING_COLORS.amberBright,
            fontFamily: "var(--font-sans)",
          }}
        >
          <RotateCcw size={12} strokeWidth={2.2} />
          Import more animals
        </button>
      </motion.div>
    </StepShell>
  );
}

// ---------------------------------------------------------------------------
// StatCard — large display-font number with a tone-tinted icon + rule.
// ---------------------------------------------------------------------------

type Tone = "success" | "warning" | "neutral";

const TONE_STYLES: Record<Tone, { accent: string; rule: string; iconBg: string; iconBorder: string; iconFg: string }> = {
  success: {
    accent: "#6B9362",
    rule: "rgba(107,147,98,0.45)",
    iconBg: "rgba(107,147,98,0.14)",
    iconBorder: "rgba(107,147,98,0.45)",
    iconFg: "#A8C99E",
  },
  warning: {
    accent: "#E5B964",
    rule: "rgba(229,185,100,0.45)",
    iconBg: "rgba(229,185,100,0.14)",
    iconBorder: "rgba(229,185,100,0.45)",
    iconFg: "#F0CF7F",
  },
  neutral: {
    accent: "#F0DEB8",
    rule: "rgba(196,144,48,0.35)",
    iconBg: "rgba(196,144,48,0.08)",
    iconBorder: "rgba(196,144,48,0.28)",
    iconFg: "#C9B48A",
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: SPRING_SOFT },
};

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: Tone;
  icon: LucideIcon;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <motion.div
      variants={cardVariants}
      className="relative overflow-hidden rounded-2xl px-5 py-5"
      style={{
        background:
          "linear-gradient(180deg, rgba(44,34,24,0.95) 0%, rgba(31,24,16,1) 100%)",
        border: "1px solid rgba(196,144,48,0.25)",
        boxShadow: "0 1px 0 rgba(245,235,212,0.04) inset, 0 10px 28px rgba(0,0,0,0.45)",
      }}
    >
      {/* Tone stripe on top */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: styles.rule }}
      />
      <div className="flex items-start justify-between">
        <div>
          <div
            className="text-[10.5px] uppercase tracking-[0.22em]"
            style={{
              color: ONBOARDING_COLORS.mutedDim,
              fontFamily: "var(--font-sans)",
            }}
          >
            {label}
          </div>
          <div
            className="mt-1 leading-none"
            style={{
              color: styles.accent,
              fontFamily: "var(--font-display)",
              fontSize: "2.25rem",
              fontWeight: 700,
              letterSpacing: "-0.015em",
            }}
          >
            {value.toLocaleString()}
          </div>
        </div>
        <div
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full"
          style={{
            background: styles.iconBg,
            border: `1px solid ${styles.iconBorder}`,
            color: styles.iconFg,
          }}
        >
          <Icon size={15} strokeWidth={2} />
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// EmberField — drifting amber particles behind the stats.
// ---------------------------------------------------------------------------

function EmberField() {
  // Deterministic positions so the layout doesn't shuffle on every re-render.
  const embers = [
    { left: "8%", delay: 0, size: 3, dur: 5.2 },
    { left: "22%", delay: 0.6, size: 2, dur: 6.1 },
    { left: "38%", delay: 1.2, size: 4, dur: 4.8 },
    { left: "54%", delay: 0.3, size: 2, dur: 5.7 },
    { left: "70%", delay: 0.9, size: 3, dur: 6.3 },
    { left: "86%", delay: 1.5, size: 2, dur: 5.4 },
    { left: "46%", delay: 2.1, size: 3, dur: 6.8 },
    { left: "14%", delay: 2.5, size: 2, dur: 5.9 },
  ];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {embers.map((e, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: e.left,
            bottom: -8,
            width: e.size,
            height: e.size,
            background:
              "radial-gradient(circle, rgba(229,185,100,0.9) 0%, rgba(196,144,48,0) 70%)",
            boxShadow: "0 0 8px rgba(229,185,100,0.5)",
          }}
          initial={{ opacity: 0, y: 0 }}
          animate={{
            opacity: [0, 0.9, 0.4, 0],
            y: [-40, -180, -320, -440],
          }}
          transition={{
            duration: e.dur,
            delay: e.delay,
            repeat: Infinity,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}
