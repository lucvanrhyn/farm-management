"use client";

/**
 * CitationChip — hover-reveal superscript chip for Farm Einstein answers.
 *
 * Rendered inline at the end of an answer where the source is referenced
 * (e.g. "rainfall dropped 38% this quarter[1]"). On hover, exposes the
 * exact quote, the entity type, and a deep-link button that navigates to
 * the underlying record in FarmTrack admin. On click, navigates.
 *
 * Kept as its own module because:
 *   1. EinsteinChat has enough surface area already (streaming state,
 *      feedback dispatch, error taxonomy).
 *   2. The deep-link map is a pure, testable function of citation type.
 *   3. A downstream Wave could wrap each chip in a PopoverPrimitive without
 *      touching the chat logic.
 */

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { Citation } from "@/lib/einstein/retriever";

export interface CitationChipProps {
  /** 1-indexed display number — the `[1]` shown to the reader. */
  readonly index: number;
  readonly citation: Citation;
  readonly farmSlug: string;
}

/**
 * Map a citation back to its admin deep-link. Exported so both the chip
 * and higher-level surfaces (e.g. Wave 3's query log viewer) render the
 * same URL for a given citation.
 */
export function citationHref(
  citation: Citation,
  farmSlug: string,
): string {
  const base = `/${farmSlug}`;
  switch (citation.entityType) {
    case "observation":
      return `${base}/admin/observations/${citation.entityId}`;
    case "camp":
      return `${base}/admin/camps/${citation.entityId}`;
    case "animal":
      return `${base}/admin/animals/${citation.entityId}`;
    case "task":
      return `${base}/admin/tasks/${citation.entityId}`;
    case "task_template":
      return `${base}/admin/settings/tasks#template-${citation.entityId}`;
    case "notification":
      return `${base}/notifications/${citation.entityId}`;
    case "it3_snapshot":
      return `${base}/admin/tax/it3`;
  }
}

/**
 * Human-readable label for each supported citation entity type. Keeps the
 * tooltip copy consistent across surfaces.
 */
const ENTITY_LABELS: Record<Citation["entityType"], string> = {
  observation: "Observation",
  camp: "Camp",
  animal: "Animal",
  task: "Task",
  task_template: "Task template",
  notification: "Notification",
  it3_snapshot: "IT3 snapshot",
};

export function CitationChip({
  index,
  citation,
  farmSlug,
}: CitationChipProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const href = citationHref(citation, farmSlug);
  const label = ENTITY_LABELS[citation.entityType];

  const onActivate = useCallback(() => {
    router.push(href);
  }, [router, href]);

  return (
    <span className="relative inline-block align-super">
      <button
        type="button"
        className="text-[0.65rem] font-mono font-medium text-amber-300 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-300 rounded px-0.5"
        aria-label={`Citation ${index}: ${label}`}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={onActivate}
      >
        [{index}]
      </button>
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-20 mb-1 w-64 -translate-x-1/2 rounded-md border border-stone-700 bg-stone-900/95 p-2 text-xs text-stone-200 shadow-lg"
        >
          <span className="block text-[0.65rem] font-semibold uppercase tracking-wider text-amber-300">
            {label}
            {citation.relevance === "direct"
              ? " · primary source"
              : citation.relevance === "supporting"
                ? " · supporting"
                : " · context"}
          </span>
          <span className="mt-1 block italic text-stone-300">
            &ldquo;{citation.quote}&rdquo;
          </span>
          <a
            href={href}
            onClick={(e) => {
              // Intercept so the parent button's onClick isn't double-fired
              // by bubbling; use router.push for SPA navigation parity.
              e.preventDefault();
              e.stopPropagation();
              onActivate();
            }}
            className="mt-2 inline-block text-[0.7rem] font-medium text-amber-300 underline-offset-2 hover:underline"
          >
            Open source →
          </a>
        </span>
      ) : null}
    </span>
  );
}

export default CitationChip;
