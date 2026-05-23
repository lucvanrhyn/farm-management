"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TypedConfirm from "./TypedConfirm";

interface Props {
  endpoint: string;   // e.g. "/api/animals/reset"
  label: string;      // e.g. "Clear All Animals"
}

/**
 * #371 — Per-section destructive clear (Animals / Observations / Transactions
 * / Sheep). Upgraded from a weak two-step "Are you sure? → Yes, clear" tap to
 * the shared typed-confirmation gate: the DELETE request stays blocked until
 * the user types "CLEAR" exactly.
 */
export default function ClearSectionButton({ endpoint, label }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function handleClear() {
    setError("");
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error ?? "Failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    }
  }

  return (
    <TypedConfirm
      phrase="CLEAR"
      triggerLabel={label}
      confirmLabel="Yes, clear"
      busyLabel="Clearing..."
      onConfirm={handleClear}
      error={error}
      size="sm"
    />
  );
}
