"use client";

/**
 * Animated 5-step progress header.
 *
 * - Connectors are a single hairline with an amber fill that scales up to the
 *   current step via framer-motion.
 * - Active step pulses with a soft amber ring (breathe animation).
 * - Completed steps render a draw-on checkmark.
 * - Labels appear in Playfair small-caps on md+ so the whole header reads like
 *   an editorial table of contents.
 */

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  STEP_ORDER,
  stepIndex,
  type OnboardingStep,
} from "@/lib/onboarding/client-types";
import { ONBOARDING_COLORS, SPRING_SOFT } from "./theme";

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: "Welcome",
  upload: "Upload",
  mapping: "Mapping",
  import: "Import",
  done: "Done",
};

type StepperProps = { current: OnboardingStep };

export function Stepper({ current }: StepperProps) {
  const currentIdx = stepIndex(current);
  const total = STEP_ORDER.length;
  // Progress ranges from 0 (welcome) to (total-1)/(total-1) = 1 (done).
  // The fill line sits BEHIND the circles and fills from left to right.
  const fillPct = total > 1 ? (currentIdx / (total - 1)) * 100 : 0;

  return (
    <nav
      aria-label="Onboarding progress"
      className="relative w-full pb-4 pt-6"
    >
      {/* Background track — spans the width between first and last circle centers */}
      <div
        aria-hidden="true"
        className="absolute left-[6%] right-[6%] top-[38px] h-px md:top-[42px]"
        style={{ background: ONBOARDING_COLORS.smoke }}
      />
      {/* Animated fill that grows with progress */}
      <motion.div
        aria-hidden="true"
        className="absolute left-[6%] top-[38px] h-px origin-left md:top-[42px]"
        style={{
          width: "88%",
          background:
            "linear-gradient(90deg, rgba(160,82,45,0.9) 0%, rgba(196,144,48,0.95) 50%, rgba(229,185,100,0.95) 100%)",
          boxShadow: "0 0 12px rgba(196,144,48,0.45)",
        }}
        initial={false}
        animate={{ scaleX: fillPct / 100 }}
        transition={SPRING_SOFT}
      />

      <ol className="relative flex items-start justify-between gap-1 md:gap-2">
        {STEP_ORDER.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;

          return (
            <li
              key={step}
              aria-current={isCurrent ? "step" : undefined}
              className="relative flex flex-1 flex-col items-center gap-2"
            >
              <StepCircle
                index={idx + 1}
                isCompleted={isCompleted}
                isCurrent={isCurrent}
              />
              <span
                className={`hidden md:block text-[10.5px] uppercase tracking-[0.2em] transition-colors ${
                  isCurrent || isCompleted ? "opacity-100" : "opacity-60"
                }`}
                style={{
                  color: isCurrent
                    ? ONBOARDING_COLORS.parchment
                    : isCompleted
                      ? ONBOARDING_COLORS.muted
                      : ONBOARDING_COLORS.whisper,
                  fontFamily: "var(--font-sans)",
                  fontWeight: isCurrent ? 600 : 500,
                }}
              >
                {STEP_LABELS[step]}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepCircle({
  index,
  isCompleted,
  isCurrent,
}: {
  index: number;
  isCompleted: boolean;
  isCurrent: boolean;
}) {
  const background = isCompleted
    ? ONBOARDING_COLORS.copper
    : isCurrent
      ? ONBOARDING_COLORS.amber
      : ONBOARDING_COLORS.bgSoft;
  const border = isCompleted
    ? "1px solid rgba(229,185,100,0.6)"
    : isCurrent
      ? "1px solid rgba(245,235,212,0.85)"
      : "1px solid #3A2A1A";
  const color = isCompleted || isCurrent ? "#1A1510" : ONBOARDING_COLORS.whisper;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 30, height: 30 }}
    >
      {/* Soft pulse ring for the active step */}
      {isCurrent ? (
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full"
          style={{
            border: "1px solid rgba(229,185,100,0.55)",
          }}
          animate={{ scale: [1, 1.35, 1], opacity: [0.55, 0, 0.55] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}

      <motion.div
        className="flex items-center justify-center rounded-full text-[11px] font-semibold"
        style={{
          width: 30,
          height: 30,
          background,
          border,
          color,
          fontFamily: "var(--font-sans)",
          boxShadow: isCurrent
            ? "0 0 16px rgba(229,185,100,0.4)"
            : isCompleted
              ? "0 0 8px rgba(160,82,45,0.35)"
              : "none",
        }}
        initial={false}
        animate={{ scale: isCurrent ? 1.08 : 1 }}
        transition={SPRING_SOFT}
      >
        {isCompleted ? (
          <motion.span
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
            aria-hidden="true"
          >
            <Check size={14} strokeWidth={3} />
          </motion.span>
        ) : (
          index
        )}
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepperFromPathname — derives the current step from the URL so the server
// layout can render the stepper without prop-drilling.
// ---------------------------------------------------------------------------

const PATH_SEGMENT_TO_STEP: Record<string, OnboardingStep> = {
  upload: "upload",
  mapping: "mapping",
  import: "import",
  done: "done",
};

function deriveStepFromPathname(pathname: string): OnboardingStep {
  const parts = pathname.split("/").filter(Boolean);
  const onboardingIdx = parts.indexOf("onboarding");
  if (onboardingIdx === -1) return "welcome";
  const segment = parts[onboardingIdx + 1];
  if (!segment) return "welcome";
  return PATH_SEGMENT_TO_STEP[segment] ?? "welcome";
}

export function StepperFromPathname() {
  const pathname = usePathname() ?? "";
  const current = deriveStepFromPathname(pathname);
  return <Stepper current={current} />;
}
