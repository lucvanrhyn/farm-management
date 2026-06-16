"use client";

/**
 * EinsteinOverlay — in-place AI Advisor chat overlay for the Home portal.
 *
 * Wraps the REAL streaming chat component (<EinsteinChat farmSlug/>) inside an
 * overlay shell so the Home "AI Advisor" tile / brief peek can open Einstein
 * WITHOUT navigating away from Home:
 *   - desktop  → centered modal (min(560px,96vw) × min(680px,88vh))
 *   - mobile   → bottom sheet (height 88%, grab handle, sticky to viewport)
 *
 * The CSS media query (NOT a device toggle) decides which presentation shows.
 * Esc and scrim-click both close. EinsteinChat itself is untouched — it keeps
 * its own SSE streaming, citations, feedback and farm-scoped fetch logic.
 */

import { useEffect } from "react";
import {
  EinsteinChat,
  type EinsteinBriefItem,
} from "@/components/einstein/EinsteinChat";
import { Icon } from "@/components/ds";

/**
 * The opening briefing shown when the sheet has no messages yet. Status-dotted
 * (poor/fair/info) prioritized items + tappable suggested-prompt chips. Chip
 * taps submit through EinsteinChat's existing send path.
 */
const SHEET_BRIEF: readonly EinsteinBriefItem[] = [
  { status: "poor", text: "Camp H mob — water trough empty, move today" },
  { status: "fair", text: "VR-014 thin in B1 — pull to kraal for feeding" },
  { status: "info", text: "3 cows clear withdrawal Saturday — sale-ready" },
];

const SHEET_PROMPTS: readonly string[] = [
  "What needs attention today?",
  "Which camps are low on feed?",
  "Where should I move the H mob?",
  "Who clears withdrawal this week?",
];

export function EinsteinOverlay({
  open,
  onClose,
  farmSlug,
  firstName,
}: {
  open: boolean;
  onClose: () => void;
  farmSlug: string;
  /** First name for the sheet greeting bubble (optional). */
  firstName?: string;
}) {
  // Esc closes the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="dark-surface ft-einstein-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Einstein AI Advisor"
    >
      {/* scrim */}
      <button
        type="button"
        aria-label="Close Einstein"
        onClick={onClose}
        className="ft-einstein-scrim"
      />

      {/* panel — modal on desktop, bottom sheet on mobile */}
      <div className="ft-einstein-panel">
        <span className="ft-einstein-grabber" aria-hidden />

        {/* close affordance pinned top-right; EinsteinChat owns the rest */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="ft-einstein-close ft-action-btn"
        >
          <Icon.close size={16} />
        </button>

        <EinsteinChat
          farmSlug={farmSlug}
          className="ft-einstein-chat"
          firstName={firstName}
          brief={SHEET_BRIEF}
          suggestedPrompts={SHEET_PROMPTS}
        />
      </div>

      <style>{OVERLAY_CSS}</style>
    </div>
  );
}

/**
 * Scoped overlay CSS. The overlay carries its OWN `dark-surface` scope — the
 * Home root is now the light "cream" surface, so the Einstein chat reads as a
 * self-contained dark modal whose warm "stage" gradient lifts above the scrim.
 */
const OVERLAY_CSS = `
.ft-einstein-overlay {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  /* The dark-surface class on this container supplies the modal's DARK token
     set (the Home behind is now the light "cream" surface). We null its opaque
     background (var --ft-bg) here so the translucent scrim below can still
     frost-blur the cream Home through the overlay. */
  background: transparent;
}
.ft-einstein-scrim {
  position: absolute; inset: 0;
  background: rgba(8,6,5,.55);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  border: 0; cursor: pointer;
  animation: ftFade .2s ease both;
}
.ft-einstein-panel {
  position: relative;
  width: min(560px, 96vw); height: min(680px, 88vh);
  display: flex; flex-direction: column; overflow: hidden;
  background: radial-gradient(ellipse at 50% 28%, #2a2018, #14110d 70%);
  border-radius: var(--ft-r-xl, 22px);
  border: 1px solid var(--ft-border, rgba(255,235,210,.13));
  box-shadow: 0 40px 120px -20px rgba(0,0,0,.7);
  animation: ftModalIn .26s cubic-bezier(.32,.72,.3,1) both;
}
.ft-einstein-grabber { display: none; }
.ft-einstein-close {
  position: absolute; top: 14px; right: 14px; z-index: 5;
  color: var(--ft-muted);
  background: var(--ft-surface);
  border: 1px solid var(--ft-border);
}
/* EinsteinChat fills the panel and scrolls internally */
.ft-einstein-chat { flex: 1; min-height: 0; height: 100%; }

@media (max-width: 620px) {
  .ft-einstein-overlay {
    align-items: flex-end; justify-content: stretch;
    padding: 0;
  }
  .ft-einstein-panel {
    width: 100%; height: 88%;
    border-radius: 26px 26px 0 0;
    border-bottom: 0;
    box-shadow: 0 -20px 60px rgba(0,0,0,.5);
    animation: ftSheetUp .32s cubic-bezier(.32,.72,.3,1) both;
  }
  .ft-einstein-grabber {
    display: block;
    position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    width: 38px; height: 4px; border-radius: 999px; z-index: 6;
    background: var(--ft-border2, rgba(255,235,210,.2));
  }
}
`;

export default EinsteinOverlay;
