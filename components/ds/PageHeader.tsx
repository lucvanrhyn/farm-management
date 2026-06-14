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
    <div className={cn("flex items-start gap-4 px-7 py-5", className)}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="ft-action-btn mt-1"
        >
          <Icon.chevronL size={20} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1
          className="ft-serif"
          style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.1, margin: 0 }}
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
      {right}
    </div>
  );
}
