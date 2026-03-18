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
        className="px-3 py-1.5 text-xs font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
      >
        {label}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-stone-600">Are you sure?</span>
      <button
        onClick={handleClear}
        disabled={isLoading}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors"
      >
        {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
        {isLoading ? "Clearing..." : "Yes, clear"}
      </button>
      <button
        onClick={() => { setConfirming(false); setError(""); }}
        disabled={isLoading}
        className="px-3 py-1.5 text-xs text-stone-600 border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
