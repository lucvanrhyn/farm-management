"use client";

/**
 * components/ui/ModalHeader.tsx — Issue #368
 *
 * Shared modal header: a title row plus an X close button, with a single
 * Escape-to-close keydown listener.
 *
 * Background. The three logger/admin modals each closed differently:
 *   - DeathModal / MobMoveModal had ONLY a bottom-sheet drag handle and a
 *     "Cancel" text button — no X, no Escape.
 *   - TransactionModal had a plain <h2> title and a "Cancel" button.
 * None offered the conventional top-right X affordance. This component
 * generalises that affordance so every modal closes consistently.
 *
 * Escape handling. The keydown listener lives here and nowhere else — the
 * adopting modals (DeathModal, MobMoveModal, TransactionModal) do NOT
 * register their own Escape handler, so there is no double-fire. The
 * listener is attached on mount and removed on unmount; an unmounted /
 * closed modal therefore cannot fire `onClose` on a stray Escape press.
 * (Adopting modals already early-return `null` when closed, so the
 * listener only exists while the modal is on screen.)
 *
 * Theming. `titleClassName` / `titleStyle` / `closeClassName` /
 * `closeStyle` let each modal keep its existing palette — the dark
 * bottom-sheet modals use a cream display font, TransactionModal uses the
 * light parchment palette — without this component hard-coding either.
 */

import { useEffect } from "react";
import { X } from "lucide-react";

interface ModalHeaderProps {
  /** Heading text shown on the left of the header row. */
  readonly title: string;
  /** Invoked on X click and on the Escape key. */
  readonly onClose: () => void;
  /** Extra classes for the outer header row (spacing/alignment overrides). */
  readonly className?: string;
  /** Extra classes for the <h2> title. */
  readonly titleClassName?: string;
  /** Inline style for the <h2> title (per-modal palette). */
  readonly titleStyle?: React.CSSProperties;
  /** Extra classes for the X close button. */
  readonly closeClassName?: string;
  /** Inline style for the X close button (per-modal palette). */
  readonly closeStyle?: React.CSSProperties;
}

export default function ModalHeader({
  title,
  onClose,
  className = "",
  titleClassName = "",
  titleStyle,
  closeClassName = "",
  closeStyle,
}: ModalHeaderProps) {
  // Escape closes the modal. Single source of truth — adopting modals
  // must not add their own Escape listener (see file docblock).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className={`flex items-start justify-between gap-3 ${className}`.trim()}
    >
      <h2
        className={`font-bold text-lg ${titleClassName}`.trim()}
        style={titleStyle}
      >
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={`shrink-0 rounded-lg p-1 transition-colors ${closeClassName}`.trim()}
        style={closeStyle}
      >
        <X className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  );
}
