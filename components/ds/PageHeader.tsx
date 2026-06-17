import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

/**
 * Screen header — Fraunces serif title + Geist-Mono subtitle, optional back
 * button and a right-aligned action slot. Mirrors the design's <Topbar>.
 */
export function PageHeader({
  title,
  subtitle,
  right,
  onBack,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  onBack?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Phone: stack the title block above the action slot so wide actions
        // (Export / Ask Einstein) never squeeze the title to zero width and
        // force the subtitle to wrap one word per line. Desktop: side-by-side.
        "flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-start sm:gap-4 sm:px-7",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="ft-action-btn mt-1 shrink-0"
          >
            <Icon.chevronL size={20} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1
            className="ft-serif"
            style={{ fontSize: "clamp(28px, 3.6vw, 36px)", fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.05, margin: 0 }}
          >
            {title}
          </h1>
          {subtitle && (
            <div
              className="ft-mono"
              style={{ fontSize: 12, color: "var(--ft-muted)", marginTop: 6, letterSpacing: ".02em" }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
