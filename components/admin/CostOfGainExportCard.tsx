"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { CogScope } from "@/lib/calculators/cost-of-gain";

type View = "camp" | "animal";

export default function CostOfGainExportCard({ farmSlug }: { farmSlug: string }) {
  const [view, setView] = useState<View>("camp");
  const [scope, setScope] = useState<CogScope>("all");

  function triggerDownload(format: "csv" | "pdf") {
    const url = `/api/${farmSlug}/export?type=cost-of-gain&view=${view}&scope=${scope}&format=${format}`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const selectStyle = {
    borderColor: "#E0D5C8",
  } as const;

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[#1C1815]">Cost of Gain</h2>
          <p
            className="text-xs mt-1 leading-relaxed"
            style={{ color: "#9C8E7A" }}
          >
            Rand per kilogram gained, broken down by camp or individual animal
            over the last 365 days.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select
              className="w-full border rounded-lg px-2 py-1.5 text-xs"
              style={selectStyle}
              value={view}
              onChange={(e) => setView(e.target.value as View)}
            >
              <option value="camp">By Camp</option>
              <option value="animal">By Animal</option>
            </select>
            <select
              className="w-full border rounded-lg px-2 py-1.5 text-xs"
              style={selectStyle}
              value={scope}
              onChange={(e) => setScope(e.target.value as CogScope)}
            >
              <option value="all">All expenses</option>
              <option value="feed_vet">Feed + Vet only</option>
            </select>
          </div>
        </div>
        <div className="shrink-0 mt-0.5 flex gap-2">
          <button
            type="button"
            onClick={() => triggerDownload("csv")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ border: "1px solid #E0D5C8", color: "#9C8E7A" }}
            title="Download CSV"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => triggerDownload("pdf")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ border: "1px solid #E0D5C8", color: "#9C8E7A" }}
            title="Download PDF"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>
      </div>
    </div>
  );
}
