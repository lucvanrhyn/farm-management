"use client";

import { useState } from "react";
import It3IssueForm from "@/components/tax/It3IssueForm";
import It3HistoryTable from "@/components/tax/It3HistoryTable";

interface It3PageClientProps {
  farmSlug: string;
  isAdmin: boolean;
}

export default function It3PageClient({ farmSlug, isAdmin }: It3PageClientProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastIssued, setLastIssued] = useState<number | null>(null);

  function handleIssued(taxYear: number) {
    setLastIssued(taxYear);
    setRefreshKey((k) => k + 1);
  }

  return (
    <>
      {lastIssued != null && (
        <div
          className="mb-5 flex items-center gap-3 rounded-xl px-4 py-3"
          style={{ background: "rgba(74,124,89,0.08)", border: "1px solid rgba(74,124,89,0.25)" }}
        >
          <p className="text-sm font-medium" style={{ color: "#2D6A4F" }}>
            <strong>Tax year {lastIssued}</strong> snapshot issued. Download it from the history table below.
          </p>
          <button
            type="button"
            onClick={() => setLastIssued(null)}
            className="ml-auto text-xs"
            style={{ color: "#9C8E7A" }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {isAdmin ? (
          <div className="space-y-5">
            <It3IssueForm farmSlug={farmSlug} onIssued={handleIssued} />
          </div>
        ) : (
          <div
            className="rounded-xl p-6"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <p className="text-sm font-semibold mb-1" style={{ color: "#1C1815" }}>
              Admin access required
            </p>
            <p className="text-xs" style={{ color: "#9C8E7A" }}>
              Only ADMIN users can issue ITR12 Farming Schedule snapshots. You can still view and download previously issued snapshots below.
            </p>
          </div>
        )}

        <div>
          <It3HistoryTable farmSlug={farmSlug} isAdmin={isAdmin} refreshKey={refreshKey} />
        </div>
      </div>
    </>
  );
}
