"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

interface Props {
  endpoint: string;   // e.g. "/api/animals/reset"
  label: string;      // e.g. "Clear All Animals"
}

export default function ClearSectionButton({ endpoint, label }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClear() {
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error ?? "Failed");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setIsLoading(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
        style={{
          border: "1px solid rgba(192,87,76,0.4)",
          color: "#C0574C",
          background: "transparent",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-xs" style={{ color: "rgba(210,180,140,0.65)" }}>Are you sure?</span>
      <button
        onClick={handleClear}
        disabled={isLoading}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-40 transition-colors"
        style={{ background: "#8B3A3A", color: "#F5EBD4" }}
      >
        {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
        {isLoading ? "Clearing..." : "Yes, clear"}
      </button>
      <button
        onClick={() => { setConfirming(false); setError(""); }}
        disabled={isLoading}
        className="px-3 py-1.5 text-xs rounded-lg transition-colors"
        style={{
          border: "1px solid rgba(139,105,20,0.25)",
          color: "rgba(210,180,140,0.65)",
          background: "transparent",
        }}
      >
        Cancel
      </button>
      {error && <span className="text-xs" style={{ color: "#C0574C" }}>{error}</span>}
    </span>
  );
}
