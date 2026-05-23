"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import TypedConfirm from "./TypedConfirm";

/**
 * #371 — "Remove All Farm Data" destructive action. Uses the shared
 * `TypedConfirm` gate (phrase "RESET"), the same primitive now used by
 * ClearSectionButton and the camps "Remove All Camps" wipe — one consistent
 * typed-confirmation pattern across every destructive bulk action.
 */
export default function DangerZone() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");

  async function handleReset() {
    setError("");
    try {
      const res = await fetch("/api/admin/reset", { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error ?? "Reset failed");
        return;
      }
      setIsOpen(false);
      router.refresh();
    } catch {
      setError("Network error — try again");
    }
  }

  return (
    <div
      className="mt-8 rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(160,50,50,0.3)", background: "rgba(139,20,20,0.05)" }}
    >
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors"
        style={{ background: "transparent" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(139,20,20,0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "#C0574C" }} />
        <span className="text-sm font-semibold flex-1" style={{ color: "#C0574C" }}>Danger Zone</span>
        {isOpen ? (
          <ChevronDown className="w-4 h-4" style={{ color: "rgba(192,87,76,0.6)" }} />
        ) : (
          <ChevronRight className="w-4 h-4" style={{ color: "rgba(192,87,76,0.6)" }} />
        )}
      </button>

      {isOpen && (
        <div
          className="px-4 pb-4 pt-3 flex flex-col gap-3"
          style={{ borderTop: "1px solid rgba(160,50,50,0.2)" }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: "#1C1815" }}>Remove All Farm Data</p>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Permanently deletes all animals, observations, transactions and categories. Users and settings are preserved.
            </p>
          </div>
          <TypedConfirm
            phrase="RESET"
            triggerLabel="Remove All Data"
            confirmLabel="Confirm Reset"
            busyLabel="Resetting..."
            onConfirm={handleReset}
            error={error}
          />
        </div>
      )}
    </div>
  );
}
