"use client";

import { useState, useEffect } from "react";
import { Download } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  status: string;
}

interface Props {
  farmSlug: string;
}

export default function RotationPlanExportCard({ farmSlug }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/${farmSlug}/rotation/plans`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const visible = (data as Plan[]).filter((p) => p.status !== "archived");
          setPlans(visible);
          if (visible.length > 0) setSelectedPlanId(visible[0].id);
        }
      })
      .catch((err) => { if (err?.name !== "AbortError") console.error("[RotationPlanExportCard] fetch failed:", err); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [farmSlug]);

  function triggerDownload(format: "csv" | "pdf") {
    if (!selectedPlanId) return;
    const url = `/api/${farmSlug}/export?type=rotation-plan&planId=${selectedPlanId}&format=${format}`;
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
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[#1C1815]">Rotation Plan</h2>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "#9C8E7A" }}>
            Export a rotation plan&apos;s steps with planned dates, mobs, and execution status.
          </p>
          {!loading && plans.length > 0 && (
            <select
              className="mt-2 w-full border rounded-lg px-2 py-1.5 text-xs"
              style={{ borderColor: "#E0D5C8" }}
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {!loading && plans.length === 0 && (
            <p className="mt-2 text-xs" style={{ color: "#9C8E7A" }}>No plans yet.</p>
          )}
        </div>
        {plans.length > 0 && (
          <div className="shrink-0 mt-0.5 flex gap-2">
            <button
              onClick={() => triggerDownload("csv")}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
              style={{ border: "1px solid #E0D5C8", color: "#9C8E7A" }}
              title="Download CSV"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            <button
              onClick={() => triggerDownload("pdf")}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
              style={{ border: "1px solid #E0D5C8", color: "#9C8E7A" }}
              title="Download PDF"
            >
              <Download className="w-3.5 h-3.5" />
              PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
