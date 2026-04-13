"use client";

import { useState, useEffect, useCallback } from "react";
import { Calculator, FileCheck2 } from "lucide-react";
import { getRecentTaxYears, getSaTaxYearRange, formatZar } from "@/lib/calculators/sars-it3";
import type { It3SnapshotPayload } from "@/lib/server/sars-it3";

interface It3IssueFormProps {
  farmSlug: string;
  onIssued: (taxYear: number) => void;
}

export default function It3IssueForm({ farmSlug, onIssued }: It3IssueFormProps) {
  // Default to the 5 most recent tax years, today.
  const taxYearOptions = getRecentTaxYears(new Date(), 5);
  const [taxYear, setTaxYear] = useState<number>(taxYearOptions[1] ?? taxYearOptions[0]);
  const [preview, setPreview] = useState<It3SnapshotPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const loadPreview = useCallback(async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/${farmSlug}/tax/it3/preview?taxYear=${year}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setError(err.error ?? "Failed to load preview");
        setPreview(null);
        return;
      }
      const json = (await res.json()) as It3SnapshotPayload;
      setPreview(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [farmSlug]);

  useEffect(() => {
    void loadPreview(taxYear);
  }, [loadPreview, taxYear]);

  async function handleIssue() {
    if (!preview) return;
    setIssuing(true);
    setError(null);
    try {
      const res = await fetch(`/api/${farmSlug}/tax/it3`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxYear }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setError(err.error ?? "Failed to issue snapshot");
        return;
      }
      onIssued(taxYear);
    } finally {
      setIssuing(false);
    }
  }

  const range = getSaTaxYearRange(taxYear);

  return (
    <div
      className="rounded-xl p-5 space-y-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div>
        <p className="text-sm font-semibold" style={{ color: "#1C1815" }}>
          Issue new snapshot
        </p>
        <p className="text-xs mt-1" style={{ color: "#9C8E7A" }}>
          Freezes the current farming schedule for the selected tax year. Edits
          to underlying transactions after issue will not alter the saved PDF.
        </p>
      </div>

      <label className="block">
        <span className="text-xs font-semibold" style={{ color: "#1C1815" }}>
          SA Tax Year
        </span>
        <select
          value={taxYear}
          onChange={(e) => setTaxYear(parseInt(e.target.value, 10))}
          className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
          style={{ border: "1px solid #E0D5C8", background: "#FAFAF8", color: "#1C1815" }}
        >
          {taxYearOptions.map((y) => (
            <option key={y} value={y}>
              {y - 1}/{y.toString().slice(-2)} (year ending {y})
            </option>
          ))}
        </select>
        <span className="text-[11px] mt-1 block font-mono" style={{ color: "#9C8E7A" }}>
          Period: {range.start} → {range.end}
        </span>
      </label>

      {loading && (
        <p className="text-xs" style={{ color: "#9C8E7A" }}>
          Loading preview…
        </p>
      )}

      {error && (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: "rgba(139,58,58,0.08)", border: "1px solid rgba(139,58,58,0.3)", color: "#8B3A3A" }}
        >
          {error}
        </div>
      )}

      {preview && !loading && (
        <div
          className="rounded-lg p-4 space-y-2"
          style={{ background: "#F5F0E8", border: "1px solid #E0D5C8" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Calculator className="w-4 h-4" style={{ color: "#4A7C59" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9C8E7A" }}>
              Preview totals
            </p>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span style={{ color: "#1C1815" }}>Total farming income</span>
            <span className="font-semibold" style={{ color: "#1C1815" }}>
              {formatZar(preview.schedules.totalIncome)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: "#1C1815" }}>Total farming expenses</span>
            <span className="font-semibold" style={{ color: "#1C1815" }}>
              {formatZar(preview.schedules.totalExpenses)}
            </span>
          </div>
          <div
            className="flex items-center justify-between text-sm pt-2"
            style={{ borderTop: "1px solid #E0D5C8" }}
          >
            <span className="font-bold" style={{ color: "#1C1815" }}>Net farming income</span>
            <span className="font-bold" style={{
              color: preview.schedules.netFarmingIncome >= 0 ? "#2D6A4F" : "#8B3A3A",
            }}>
              {formatZar(preview.schedules.netFarmingIncome)}
            </span>
          </div>
          <p className="text-[11px] mt-2" style={{ color: "#9C8E7A" }}>
            {preview.schedules.transactionCount} transactions in range •{" "}
            {preview.schedules.income.length} income line{preview.schedules.income.length === 1 ? "" : "s"} •{" "}
            {preview.schedules.expense.length} expense line{preview.schedules.expense.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      <button
        type="button"
        disabled={!preview || issuing || loading}
        onClick={() => void handleIssue()}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
        style={{ background: "#4A7C59", color: "#FFFFFF" }}
      >
        <FileCheck2 className="w-4 h-4" />
        {issuing ? "Issuing…" : `Issue snapshot for ${taxYear}`}
      </button>
    </div>
  );
}
