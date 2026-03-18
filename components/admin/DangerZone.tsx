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
    <div className="mt-8 rounded-xl border border-red-200 bg-red-50/40 overflow-hidden">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-red-50/60 transition-colors"
      >
        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
        <span className="text-sm font-semibold text-red-700 flex-1">Danger Zone</span>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-red-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-red-400" />
        )}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 border-t border-red-200 pt-3 flex flex-col gap-3">
          {!confirming ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-stone-800">Remove All Farm Data</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Permanently deletes all animals, observations, transactions and categories. Users and settings are preserved.
                </p>
              </div>
              <button
                onClick={openConfirm}
                className="ml-4 shrink-0 px-3 py-1.5 text-sm font-medium border border-red-400 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              >
                Remove All Data
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-stone-700">
                This action is <span className="font-semibold text-red-600">irreversible</span>.
                Type <span className="font-mono font-bold text-stone-900">RESET</span> to confirm.
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type RESET"
                className="w-48 border border-stone-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400"
                autoFocus
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  disabled={confirmText !== "RESET" || isLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  {isLoading ? "Resetting..." : "Confirm Reset"}
                </button>
                <button
                  onClick={cancelConfirm}
                  disabled={isLoading}
                  className="px-3 py-1.5 text-sm text-stone-600 border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
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
