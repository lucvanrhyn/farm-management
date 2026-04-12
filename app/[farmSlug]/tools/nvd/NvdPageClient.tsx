"use client";

import { useState } from "react";
import NvdIssueForm from "@/components/nvd/NvdIssueForm";
import NvdHistoryTable from "@/components/nvd/NvdHistoryTable";

interface NvdPageClientProps {
  farmSlug: string;
  isAdmin: boolean;
}

export default function NvdPageClient({ farmSlug, isAdmin }: NvdPageClientProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastNvd, setLastNvd] = useState<string | null>(null);

  function handleIssued(nvdNumber: string) {
    setLastNvd(nvdNumber);
    setRefreshKey((k) => k + 1);
  }

  return (
    <>
      {lastNvd && (
        <div
          className="mb-5 flex items-center gap-3 rounded-xl px-4 py-3"
          style={{ background: "rgba(74,124,89,0.08)", border: "1px solid rgba(74,124,89,0.25)" }}
        >
          <p className="text-sm font-medium" style={{ color: "#2D6A4F" }}>
            <strong>{lastNvd}</strong> issued. Download it from the history table below.
          </p>
          <button
            type="button"
            onClick={() => setLastNvd(null)}
            className="ml-auto text-xs"
            style={{ color: "#9C8E7A" }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Issue form — left column */}
        {isAdmin ? (
          <div className="space-y-5">
            <NvdIssueForm farmSlug={farmSlug} onIssued={handleIssued} />
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
              Only ADMIN users can issue NVDs. You can still view and download previously issued NVDs below.
            </p>
          </div>
        )}

        {/* History table — right column */}
        <div>
          <NvdHistoryTable farmSlug={farmSlug} isAdmin={isAdmin} refreshKey={refreshKey} />
        </div>
      </div>
    </>
  );
}
