"use client";

import { useState, useEffect, useCallback } from "react";
import { FileDown, XCircle } from "lucide-react";

interface NvdRecord {
  id: string;
  nvdNumber: string;
  issuedAt: string;
  saleDate: string;
  buyerName: string;
  headCount: number;
  generatedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  transactionId: string | null;
}

interface ApiResponse {
  records: NvdRecord[];
  total: number;
  page: number;
  limit: number;
}

interface NvdHistoryTableProps {
  farmSlug: string;
  isAdmin: boolean;
  /** Refresh trigger — increment to force a reload */
  refreshKey?: number;
}

export default function NvdHistoryTable({ farmSlug, isAdmin, refreshKey = 0 }: NvdHistoryTableProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/${farmSlug}/nvd?page=${p}`);
      if (res.ok) {
        const json = (await res.json()) as ApiResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [farmSlug]);

  useEffect(() => {
    void load(page);
  }, [load, page, refreshKey]);

  async function handleDownload(id: string, nvdNumber: string) {
    const res = await fetch(`/api/${farmSlug}/nvd/${id}/pdf`);
    if (!res.ok) { alert("Failed to download PDF"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nvdNumber}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleVoid(id: string) {
    const reason = window.prompt("Reason for voiding this NVD:");
    if (!reason) return;
    setVoidingId(id);
    try {
      const res = await fetch(`/api/${farmSlug}/nvd/${id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "Failed to void NVD");
      } else {
        void load(page);
      }
    } finally {
      setVoidingId(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}>
        <p className="text-sm" style={{ color: "#9C8E7A" }}>Loading NVD history…</p>
      </div>
    );
  }

  const records = data?.records ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #E0D5C8" }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ background: "#F5F0E8", borderBottom: "1px solid #E0D5C8" }}>
        <p className="text-sm font-semibold" style={{ color: "#1C1815" }}>
          Issued NVDs
        </p>
        <p className="text-xs" style={{ color: "#9C8E7A" }}>
          {total} total
        </p>
      </div>

      {records.length === 0 ? (
        <div className="p-6 text-center" style={{ background: "#FFFFFF" }}>
          <p className="text-sm" style={{ color: "#9C8E7A" }}>No NVDs issued yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto" style={{ background: "#FFFFFF" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#FAFAF8", borderBottom: "1px solid #E0D5C8" }}>
                <th className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: "#9C8E7A" }}>NVD Number</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: "#9C8E7A" }}>Sale Date</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: "#9C8E7A" }}>Buyer</th>
                <th className="text-right px-4 py-2.5 font-semibold text-xs" style={{ color: "#9C8E7A" }}>Head</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: "#9C8E7A" }}>Status</th>
                <th className="text-right px-4 py-2.5 font-semibold text-xs" style={{ color: "#9C8E7A" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr
                  key={r.id}
                  style={{
                    background: i % 2 === 0 ? "#FFFFFF" : "#FAFAF8",
                    borderBottom: "1px solid #F0E8DE",
                    opacity: r.voidedAt ? 0.55 : 1,
                  }}
                >
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: "#1C1815" }}>
                    {r.nvdNumber}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "#1C1815" }}>
                    {r.saleDate}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "#1C1815" }}>
                    {r.buyerName}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right" style={{ color: "#1C1815" }}>
                    {r.headCount}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.voidedAt ? (
                      <span
                        className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(139,58,58,0.1)", color: "#8B3A3A" }}
                        title={r.voidReason ?? ""}
                      >
                        Voided
                      </span>
                    ) : (
                      <span
                        className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(74,124,89,0.1)", color: "#2D6A4F" }}
                      >
                        Issued
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDownload(r.id, r.nvdNumber)}
                        title="Download PDF"
                        className="p-1 rounded transition-opacity hover:opacity-70"
                        style={{ color: "#4A7C59" }}
                      >
                        <FileDown className="w-4 h-4" />
                      </button>
                      {isAdmin && !r.voidedAt && (
                        <button
                          type="button"
                          onClick={() => void handleVoid(r.id)}
                          disabled={voidingId === r.id}
                          title="Void NVD"
                          className="p-1 rounded transition-opacity hover:opacity-70 disabled:opacity-40"
                          style={{ color: "#8B3A3A" }}
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3" style={{ background: "#FAFAF8", borderTop: "1px solid #E0D5C8" }}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: "rgba(74,124,89,0.1)", color: "#4A7C59" }}
          >
            Previous
          </button>
          <p className="text-xs" style={{ color: "#9C8E7A" }}>
            Page {page} of {totalPages}
          </p>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: "rgba(74,124,89,0.1)", color: "#4A7C59" }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
