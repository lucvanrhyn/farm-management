"use client";

import { useState, useEffect, useCallback } from "react";
import { Download, Receipt } from "lucide-react";
import { getRecentTaxYears } from "@/lib/calculators/sars-it3";

interface It3Record {
  id: string;
  taxYear: number;
  issuedAt: string;
  voidedAt: string | null;
}

interface ApiResponse {
  records: It3Record[];
}

/**
 * Reports-page card for the SARS IT3 tax export.
 *
 * Lists the most recent non-voided IT3 snapshots (up to 5 years) so the
 * accountant can grab the PDF or CSV for the year they're filing without
 * navigating to the tools page.
 */
export default function It3ExportCard({ farmSlug }: { farmSlug: string }) {
  const [activeSnapshots, setActiveSnapshots] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/${farmSlug}/tax/it3?page=1`);
      if (res.ok) {
        const json = (await res.json()) as ApiResponse;
        const active = new Map<number, string>();
        for (const r of json.records) {
          if (!r.voidedAt && !active.has(r.taxYear)) {
            active.set(r.taxYear, r.id);
          }
        }
        setActiveSnapshots(active);
      }
    } finally {
      setLoading(false);
    }
  }, [farmSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  function triggerDownload(id: string, taxYear: number) {
    const url = `/api/${farmSlug}/tax/it3/${id}/pdf`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener noreferrer";
    a.download = `sars-it3-${taxYear}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function triggerCsv(taxYear: number) {
    const url = `/api/${farmSlug}/export?type=sars-it3&taxYear=${taxYear}&format=csv`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const recentYears = getRecentTaxYears(new Date(), 5);

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(74,124,89,0.1)" }}
        >
          <Receipt className="w-4 h-4" style={{ color: "#4A7C59" }} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[#1C1815]">SARS IT3 Tax Export</h2>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "#9C8E7A" }}>
            Year-end farming income &amp; expense schedule mapped onto ITR12 line codes. Issue snapshots on the{" "}
            <a
              href={`/${farmSlug}/tools/tax`}
              className="underline"
              style={{ color: "#4A7C59" }}
            >
              Tax tools
            </a>{" "}
            page first.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading && (
          <p className="text-xs" style={{ color: "#9C8E7A" }}>
            Loading snapshots…
          </p>
        )}
        {!loading && activeSnapshots.size === 0 && (
          <p className="text-xs" style={{ color: "#9C8E7A" }}>
            No active snapshots yet. Issue one from the Tax tools page.
          </p>
        )}
        {!loading &&
          recentYears
            .filter((y) => activeSnapshots.has(y))
            .map((y) => {
              const id = activeSnapshots.get(y);
              if (!id) return null;
              return (
                <div
                  key={y}
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                  style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
                >
                  <span className="text-xs font-mono font-semibold" style={{ color: "#1C1815" }}>
                    Tax year {y}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => triggerCsv(y)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium"
                      style={{ border: "1px solid #E0D5C8", color: "#9C8E7A" }}
                      title="Download CSV"
                    >
                      <Download className="w-3 h-3" />
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerDownload(id, y)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium"
                      style={{ border: "1px solid #E0D5C8", color: "#9C8E7A" }}
                      title="Download PDF"
                    >
                      <Download className="w-3 h-3" />
                      PDF
                    </button>
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
}
