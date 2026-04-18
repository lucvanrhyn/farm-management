"use client";

import { usePathname } from "next/navigation";
import {
  STEP_ORDER,
  stepIndex,
  type OnboardingStep,
} from "@/lib/onboarding/client-types";

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

  return (
    <nav
      aria-label="Onboarding progress"
      className="w-full flex items-center justify-between gap-2 md:gap-3 py-6"
    >
      {STEP_ORDER.map((step, idx) => {
        const isCompleted = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isPending = idx > currentIdx;

        const circleStyle: React.CSSProperties = isCompleted
          ? {
              background: "#15803D",
              color: "#F0DEB8",
              border: "1px solid #166534",
            }
          : isCurrent
          ? {
              background: "#C49030",
              color: "#1A1510",
              border: "1px solid #C49030",
              boxShadow: "0 0 0 4px rgba(196,144,48,0.25)",
            }
          : {
              background: "transparent",
              color: "#6A4E30",
              border: "1px solid #3A2A1A",
            };

        const connectorColor = isCompleted ? "#15803D" : "#3A2A1A";

        return (
          <div
            key={step}
            className="flex items-center flex-1 min-w-0"
            aria-current={isCurrent ? "step" : undefined}
          >
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all"
                style={circleStyle}
              >
                {isCompleted ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className="hidden md:block text-[11px] uppercase tracking-wider whitespace-nowrap"
                style={{
                  color: isPending ? "#6A4E30" : "#8A6840",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {idx < STEP_ORDER.length - 1 ? (
              <div
                className="flex-1 h-[1px] mx-2 md:mx-3 min-w-[12px] md:min-w-[24px]"
                style={{ background: connectorColor }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// StepperFromPathname — infers the current step from the URL pathname so
// server components can render the stepper without prop-drilling the step.
// ---------------------------------------------------------------------------

const PATH_SEGMENT_TO_STEP: Record<string, OnboardingStep> = {
  upload: "upload",
  mapping: "mapping",
  import: "import",
  done: "done",
};

function deriveStepFromPathname(pathname: string): OnboardingStep {
  // Path looks like `/<slug>/onboarding` or `/<slug>/onboarding/<step>`.
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
