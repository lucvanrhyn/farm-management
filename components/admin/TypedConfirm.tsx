"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * #371 — Shared typed-confirmation gate for destructive bulk actions.
 *
 * One consistent pattern for every destructive bulk action in the admin
 * surface (the "Remove All Farm Data" RESET in DangerZone, the per-section
 * ClearSectionButton clears, and the camps "Remove All Camps" wipe). It
 * replaces the two weaker patterns that existed before: a bare native
 * `window.confirm()` and a weak two-step "Are you sure? → Yes" tap.
 *
 * Behaviour:
 *   - Initially renders only the destructive trigger button.
 *   - Clicking the trigger reveals an input; the action stays blocked.
 *   - The confirm button is disabled until the EXACT phrase is typed
 *     (case-sensitive, no leading/trailing whitespace tolerance).
 *   - Cancel returns to the trigger without firing the action.
 *
 * `onConfirm` may be async; while it runs the confirm button shows a
 * spinner and the input/cancel are disabled. `error` lets the caller
 * surface a server-side failure message inline.
 */
export interface TypedConfirmProps {
  /** Exact phrase the user must type to unlock the action (e.g. "RESET"). */
  phrase: string;
  /** Label on the initial destructive trigger button. */
  triggerLabel: string;
  /** Label on the final confirm button once the input is revealed. */
  confirmLabel: string;
  /** Fired only when the typed phrase matches exactly. May be async. */
  onConfirm: () => void | Promise<void>;
  /** Optional explanatory copy shown above the input. */
  description?: string;
  /** Optional inline error message (e.g. a failed server request). */
  error?: string;
  /** Optional busy flag — caller-driven; also derived internally for async onConfirm. */
  busy?: boolean;
  /** Optional busy label for the confirm button (default: confirmLabel). */
  busyLabel?: string;
  /** Visual size — "sm" for inline contexts (ClearSectionButton). */
  size?: "sm" | "md";
}

export default function TypedConfirm({
  phrase,
  triggerLabel,
  confirmLabel,
  onConfirm,
  description,
  error,
  busy = false,
  busyLabel,
  size = "md",
}: TypedConfirmProps) {
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [internalBusy, setInternalBusy] = useState(false);

  const isBusy = busy || internalBusy;
  const matches = text === phrase;
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const padding = size === "sm" ? "px-3 py-1.5" : "px-3 py-1.5";

  function open() {
    setText("");
    setConfirming(true);
  }

  function cancel() {
    setText("");
    setConfirming(false);
  }

  async function handleConfirm() {
    if (text !== phrase || isBusy) return;
    setInternalBusy(true);
    try {
      await onConfirm();
    } finally {
      setInternalBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={open}
        disabled={isBusy}
        className={`${textSize} ${padding} font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
        style={{
          border: "1px solid rgba(192,87,76,0.5)",
          color: "#C0574C",
          background: "transparent",
        }}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs" style={{ color: "#6B5C4E" }}>
        {description ? `${description} ` : ""}
        This action is{" "}
        <span className="font-semibold" style={{ color: "#C0574C" }}>
          irreversible
        </span>
        . Type{" "}
        <span className="font-mono font-bold" style={{ color: "#1C1815" }}>
          {phrase}
        </span>{" "}
        to confirm.
      </p>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Type ${phrase}`}
        disabled={isBusy}
        autoFocus
        className="w-48 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none disabled:opacity-50"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(192,87,76,0.4)",
          color: "#1C1815",
        }}
      />
      {error && (
        <p className="text-xs" style={{ color: "#C0574C" }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!matches || isBusy}
          className={`flex items-center gap-1.5 ${padding} ${textSize} font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
          style={{ background: "#8B3A3A", color: "#F5EBD4" }}
        >
          {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
          {isBusy ? busyLabel ?? confirmLabel : confirmLabel}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isBusy}
          className={`${padding} ${textSize} rounded-lg transition-colors disabled:opacity-40`}
          style={{
            border: "1px solid #E0D5C8",
            color: "#6B5C4E",
            background: "transparent",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
