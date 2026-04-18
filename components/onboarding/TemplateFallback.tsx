"use client";

import type { JSX } from "react";
import { Button } from "@/components/ui/Button";

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
  "upstream-error": "AI mapping is temporarily unavailable",
  "validation-error": "We couldn't read that file",
  unknown: "Something went wrong",
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
      return "You've hit today's AI import quota. Download the blank template, fill it in, and re-upload — no AI required.";
    case "upstream-error":
      return reason.message
        ? `The AI service reported an error: ${reason.message}. You can still onboard manually by filling in our blank template.`
        : "The AI service is having a moment. You can still onboard manually by filling in our blank template.";
    case "validation-error":
      return `${reason.message} Download the blank template below — it has the exact columns we need.`;
    case "unknown":
      return reason.message
        ? `Unexpected error: ${reason.message}. You can still onboard manually with our blank template.`
        : "Something unexpected happened. You can still onboard manually with our blank template.";
  }
}

export function TemplateFallback({
  reason,
  onRetry,
  consultingEmail = "support@farmtrack.app",
}: Props): JSX.Element {
  const heading = HEADINGS[reason.kind];
  const description = describe(reason);
  const showRetryTimer =
    reason.kind === "rate-limit" && typeof reason.retryAfterMs === "number";
  const mailtoHref = `mailto:${consultingEmail}?subject=${encodeURIComponent(
    "FarmTrack onboarding help",
  )}`;

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-600/60 bg-[#241C14] p-5 shadow-sm"
    >
      <h3 className="text-base font-semibold text-amber-200">{heading}</h3>
      <p className="mt-2 text-sm leading-relaxed text-amber-100/80">
        {description}
      </p>
      {showRetryTimer && reason.kind === "rate-limit" && (
        <p className="mt-2 text-xs font-medium text-amber-300">
          Try again in {formatDuration(reason.retryAfterMs ?? 0)}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button asChild variant="default">
          <a
            href="/api/onboarding/template"
            download="farmtrack-import-template.xlsx"
          >
            Download blank template
          </a>
        </Button>
        {onRetry && (
          <Button variant="outline" onClick={onRetry} type="button">
            Try AI mapping again
          </Button>
        )}
        <a
          href={mailtoHref}
          className="text-sm text-amber-300 underline-offset-4 hover:underline"
        >
          Email me for consulting help
        </a>
      </div>
    </div>
  );
}
