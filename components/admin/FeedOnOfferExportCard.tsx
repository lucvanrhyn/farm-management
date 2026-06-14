"use client";

import { Download } from "lucide-react";

export default function FeedOnOfferExportCard({ farmSlug }: { farmSlug: string }) {
  function triggerDownload(format: "csv" | "pdf") {
    const url = `/api/${farmSlug}/export?type=feed-on-offer&format=${format}`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--ft-text)]">Feed on Offer</h2>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--ft-subtle)" }}>
            Per-camp status, effective inventory, LSU-day capacity, and trend slope.
          </p>
        </div>
        <div className="shrink-0 mt-0.5 flex gap-2">
          <button
            type="button"
            onClick={() => triggerDownload("csv")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ border: "1px solid var(--ft-border)", color: "var(--ft-subtle)" }}
            title="Download CSV"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => triggerDownload("pdf")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ border: "1px solid var(--ft-border)", color: "var(--ft-subtle)" }}
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
