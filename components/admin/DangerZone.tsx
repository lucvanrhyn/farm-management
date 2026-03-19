"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

export default function DangerZone() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  function openConfirm() {
    setConfirming(true);
    setConfirmText("");
    setError("");
  }

  function cancelConfirm() {
    setConfirming(false);
    setConfirmText("");
    setError("");
  }

  async function handleReset() {
    if (confirmText !== "RESET") return;
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/reset", { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error ?? "Reset failed");
        return;
      }
      setConfirming(false);
      setConfirmText("");
      setIsOpen(false);
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setIsLoading(false);
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
          {!confirming ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: "#F5EBD4" }}>Remove All Farm Data</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(210,180,140,0.5)" }}>
                  Permanently deletes all animals, observations, transactions and categories. Users and settings are preserved.
                </p>
              </div>
              <button
                onClick={openConfirm}
                className="ml-4 shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
                style={{
                  border: "1px solid rgba(192,87,76,0.5)",
                  color: "#C0574C",
                  background: "transparent",
                }}
              >
                Remove All Data
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs" style={{ color: "rgba(210,180,140,0.75)" }}>
                This action is <span className="font-semibold" style={{ color: "#C0574C" }}>irreversible</span>.
                Type <span className="font-mono font-bold" style={{ color: "#F5EBD4" }}>RESET</span> to confirm.
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type RESET"
                className="w-48 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none"
                style={{
                  background: "#1A1510",
                  border: "1px solid rgba(192,87,76,0.4)",
                  color: "#F5EBD4",
                }}
                autoFocus
              />
              {error && <p className="text-xs" style={{ color: "#C0574C" }}>{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  disabled={confirmText !== "RESET" || isLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  style={{ background: "#8B3A3A", color: "#F5EBD4" }}
                >
                  {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  {isLoading ? "Resetting..." : "Confirm Reset"}
                </button>
                <button
                  onClick={cancelConfirm}
                  disabled={isLoading}
                  className="px-3 py-1.5 text-sm rounded-lg transition-colors"
                  style={{
                    border: "1px solid rgba(139,105,20,0.25)",
                    color: "rgba(210,180,140,0.65)",
                    background: "transparent",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
