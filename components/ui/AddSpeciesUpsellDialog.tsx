"use client";

/**
 * components/ui/AddSpeciesUpsellDialog.tsx — Issue #235
 *
 * Tiny info-dialog surfaced when a user clicks the dimmed "+ Add species"
 * pill in `ModeSwitcher` on a single-species tenant. Purposefully bare —
 * just an explainer + a `mailto:` contact link. Building a full pricing
 * surface is explicitly out of scope for this wave.
 *
 * Click destination decision (recorded in PR body):
 *   - dialog > /pricing route
 *   - rationale: the only existing pricing-adjacent surface is
 *     /[farmSlug]/admin/billing, which lives inside the authenticated
 *     tenant shell and is itself in flux. A dialog avoids coupling the
 *     upsell pill to that surface and keeps the contact path one
 *     click away.
 */

import { useEffect, useRef } from "react";

interface AddSpeciesUpsellDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const CONTACT_EMAIL = "hello@farmtrack.app";

export function AddSpeciesUpsellDialog({
  open,
  onClose,
}: AddSpeciesUpsellDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus the close button on open so keyboard users land somewhere
  // sensible without trapping focus inside the (very small) dialog.
  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  // Escape closes — minimal a11y pass for a one-button modal.
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // The backdrop receives clicks too — feels native on touch.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-species-upsell-title"
        className="w-full max-w-md rounded-2xl border border-amber-700/30 bg-stone-900 p-6 text-stone-100 shadow-2xl"
        // Stop click-through so a click on the body doesn't bubble to the
        // backdrop's onClose.
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="add-species-upsell-title"
          className="text-lg font-semibold text-amber-200"
        >
          Add another species to your farm
        </h2>

        <p className="mt-3 text-sm text-stone-300">
          Your account currently tracks one species. FarmTrack supports
          cattle, sheep, and game on the same farm — with merged LSU,
          separate inventories, and species-aware rotation planning.
        </p>

        <p className="mt-3 text-sm text-stone-300">
          To enable additional species, reach out and we&apos;ll get you
          set up.
        </p>

        <div className="mt-5 flex items-center justify-between gap-3">
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
              "Add species to my FarmTrack account",
            )}`}
            className="rounded-lg border border-amber-700/40 bg-amber-900/30 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-900/50"
          >
            Contact us
          </a>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-stone-300 hover:text-stone-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
