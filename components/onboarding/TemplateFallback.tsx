"use client";

/**
 * Error-path fallback card.
 *
 * When the AI call fails (rate-limit, upstream error, validation, unknown)
 * we still want the farmer unblocked. This card routes them to the blank
 * Excel template and offers a retry for transient failures. Parchment card
 * style matches the rest of the wizard, with a reason-specific icon + copy.
 */

import type { JSX } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Clock,
  CloudOff,
  Download,
  Mail,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { ONBOARDING_COLORS, SPRING_SOFT } from "./theme";

export type TemplateFallbackReason =
  | { kind: "rate-limit"; retryAfterMs?: number }
  | { kind: "upstream-error"; message?: string }
  | { kind: "validation-error"; message: string }
  | { kind: "unknown"; message?: string };

type Props = {
  reason: TemplateFallbackReason;
  onRetry?: () => void;
  consultingEmail?: string;
};

const HEADINGS: Record<TemplateFallbackReason["kind"], string> = {
  "rate-limit": "Daily AI limit reached",
  "upstream-error": "The AI paused for breath",
  "validation-error": "We couldn't read that file",
  unknown: "Something unexpected happened",
};

const ICONS: Record<TemplateFallbackReason["kind"], LucideIcon> = {
  "rate-limit": Clock,
  "upstream-error": CloudOff,
  "validation-error": AlertTriangle,
  unknown: AlertTriangle,
};

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function describe(reason: TemplateFallbackReason): string {
  switch (reason.kind) {
    case "rate-limit":
      return "You've hit today's AI quota. No drama — download the blank template, fill it in, and re-upload. The importer handles it the same way.";
    case "upstream-error":
      return reason.message
        ? `The AI service reported: ${reason.message}. You can still onboard manually with our blank template.`
        : "The AI service is having a moment. You can still onboard manually with our blank template.";
    case "validation-error":
      return `${reason.message} Download the blank template — it has the exact columns we need.`;
    case "unknown":
      return reason.message
        ? `Unexpected error: ${reason.message}. The blank template path still works.`
        : "Something unexpected happened. The blank template path still works.";
  }
}

export function TemplateFallback({
  reason,
  onRetry,
  consultingEmail = "support@farmtrack.app",
}: Props): JSX.Element {
  const heading = HEADINGS[reason.kind];
  const description = describe(reason);
  const Icon = ICONS[reason.kind];
  const showRetryTimer =
    reason.kind === "rate-limit" && typeof reason.retryAfterMs === "number";
  const mailtoHref = `mailto:${consultingEmail}?subject=${encodeURIComponent(
    "FarmTrack onboarding help",
  )}`;

  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING_SOFT}
      className="relative overflow-hidden rounded-[1.5rem] px-6 py-6 md:px-8 md:py-7"
      style={{
        background:
          "linear-gradient(180deg, rgba(200,81,58,0.08) 0%, rgba(36,28,20,0.95) 55%, rgba(36,28,20,1) 100%)",
        border: "1px solid rgba(200,81,58,0.35)",
        boxShadow:
          "0 1px 0 rgba(245,235,212,0.04) inset, 0 0 36px rgba(200,81,58,0.08), 0 12px 32px rgba(0,0,0,0.5)",
      }}
    >
      <div className="flex items-start gap-4">
        <motion.div
          initial={{ scale: 0.6, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "rgba(200,81,58,0.15)",
            border: "1px solid rgba(200,81,58,0.45)",
            color: "#E88C78",
          }}
        >
          <Icon size={18} strokeWidth={2.2} />
        </motion.div>
        <div className="flex-1">
          <h3
            style={{
              color: ONBOARDING_COLORS.cream,
              fontFamily: "var(--font-display)",
              fontSize: "1.15rem",
              fontWeight: 600,
            }}
          >
            {heading}
          </h3>
          <p
            className="mt-2 text-[0.875rem] leading-[1.6]"
            style={{
              color: ONBOARDING_COLORS.muted,
              fontFamily: "var(--font-sans)",
            }}
          >
            {description}
          </p>
          {showRetryTimer && reason.kind === "rate-limit" ? (
            <p
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
              style={{
                color: ONBOARDING_COLORS.amberBright,
                borderColor: "rgba(229,185,100,0.45)",
                background: "rgba(229,185,100,0.08)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <Clock size={11} strokeWidth={2.2} />
              Try again in {formatDuration(reason.retryAfterMs ?? 0)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a
          href="/api/onboarding/template"
          download="farmtrack-import-template.xlsx"
          className="group inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold"
          style={{
            background:
              "linear-gradient(135deg, rgba(229,185,100,0.95) 0%, rgba(196,144,48,0.95) 45%, rgba(160,82,45,0.95) 100%)",
            color: "#1A1510",
            boxShadow: "0 8px 24px rgba(196,144,48,0.3), 0 1px 0 rgba(245,235,212,0.2) inset",
            fontFamily: "var(--font-sans)",
          }}
        >
          <Download size={14} strokeWidth={2.5} className="transition-transform group-hover:-translate-y-0.5" />
          Download blank template
        </a>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="group inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-colors"
            style={{
              background: "transparent",
              border: "1px solid rgba(196,144,48,0.45)",
              color: ONBOARDING_COLORS.parchment,
              fontFamily: "var(--font-sans)",
            }}
          >
            <RotateCcw size={13} strokeWidth={2.2} className="transition-transform group-hover:-rotate-45" />
            Try AI mapping again
          </button>
        ) : null}
        <a
          href={mailtoHref}
          className="inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
          style={{
            color: ONBOARDING_COLORS.amberBright,
            fontFamily: "var(--font-sans)",
          }}
        >
          <Mail size={12} strokeWidth={2.2} />
          Email me for consulting help
        </a>
      </div>
    </motion.div>
  );
}
