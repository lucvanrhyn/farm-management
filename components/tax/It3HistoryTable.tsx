"use client";

import { useState, useEffect, useCallback } from "react";
import { FileDown, XCircle } from "lucide-react";

interface It3Record {
  id: string;
  taxYear: number;
  issuedAt: string;
  periodStart: string;
  periodEnd: string;
  generatedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

interface ApiResponse {
  records: It3Record[];
  total: number;
  page: number;
  limit: number;
}

interface It3HistoryTableProps {
  farmSlug: string;
  isAdmin: boolean;
  refreshKey?: number;
}

export default function It3HistoryTable({ farmSlug, isAdmin, refreshKey = 0 }: It3HistoryTableProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/${farmSlug}/tax/it3?page=${p}`);
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

  async function handleDownload(id: string, taxYear: number) {
    const res = await fetch(`/api/${farmSlug}/tax/it3/${id}/pdf`);
    if (!res.ok) { alert("Failed to download PDF"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sars-it3-${taxYear}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleVoid(id: string) {
    const reason = window.prompt("Reason for voiding this snapshot:");
    if (!reason) return;
    setVoidingId(id);
    try {
      const res = await fetch(`/api/${farmSlug}/tax/it3/${id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "Failed to void snapshot");
      } else {
        void load(page);
      }
    } finally {
      setVoidingId(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}>
        <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>Loading IT3 history…</p>
      </div>
    );
  }

  const records = data?.records ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--ft-border)" }}>
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--ft-surface)", borderBottom: "1px solid var(--ft-border)" }}
      >
        <p className="text-sm font-semibold" style={{ color: "var(--ft-text)" }}>
          Issued snapshots
        </p>
        <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>
          {total} total
        </p>
      </div>

      {records.length === 0 ? (
        <div className="p-6 text-center" style={{ background: "var(--ft-surface)" }}>
          <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>No IT3 snapshots issued yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto" style={{ background: "var(--ft-surface)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--ft-bg)", borderBottom: "1px solid var(--ft-border)" }}>
                <th className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: "var(--ft-subtle)" }}>Tax Year</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: "var(--ft-subtle)" }}>Period</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: "var(--ft-subtle)" }}>Issued</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: "var(--ft-subtle)" }}>Status</th>
                <th className="text-right px-4 py-2.5 font-semibold text-xs" style={{ color: "var(--ft-subtle)" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr
                  key={r.id}
                  style={{
                    background: i % 2 === 0 ? "#FFFFFF" : "var(--ft-bg)",
                    borderBottom: "1px solid var(--ft-surface)",
                    opacity: r.voidedAt ? 0.55 : 1,
                  }}
                >
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: "var(--ft-text)" }}>
                    {r.taxYear}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono" style={{ color: "var(--ft-text)" }}>
                    {r.periodStart} → {r.periodEnd}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--ft-text)" }}>
                    {r.issuedAt.slice(0, 10)}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.voidedAt ? (
                      <span
                        className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(139,58,58,0.1)", color: "var(--ft-crit)" }}
                        title={r.voidReason ?? ""}
                      >
                        Voided
                      </span>
                    ) : (
                      <span
                        className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(74,124,89,0.1)", color: "var(--ft-good)" }}
                      >
                        Issued
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDownload(r.id, r.taxYear)}
                        title="Download PDF"
                        className="p-1 rounded transition-opacity hover:opacity-70"
                        style={{ color: "var(--ft-good)" }}
                      >
                        <FileDown className="w-4 h-4" />
                      </button>
                      {isAdmin && !r.voidedAt && (
                        <button
                          type="button"
                          onClick={() => void handleVoid(r.id)}
                          disabled={voidingId === r.id}
                          title="Void snapshot"
                          className="p-1 rounded transition-opacity hover:opacity-70 disabled:opacity-40"
                          style={{ color: "var(--ft-crit)" }}
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
        <div className="flex items-center justify-between px-4 py-3" style={{ background: "var(--ft-bg)", borderTop: "1px solid var(--ft-border)" }}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: "rgba(74,124,89,0.1)", color: "var(--ft-good)" }}
          >
            Previous
          </button>
          <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>
            Page {page} of {totalPages}
          </p>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: "rgba(74,124,89,0.1)", color: "var(--ft-good)" }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
