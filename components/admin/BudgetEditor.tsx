"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Category {
  id: string;
  name: string;
  type: string;
}

interface BudgetRecord {
  id: string;
  year: number;
  month: number;
  categoryName: string;
  type: string;
  amount: number;
  notes: string | null;
}

interface Props {
  farmSlug: string;
  categories: Category[];
}

const fieldStyle: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E0D5C8",
  color: "#1C1815",
  borderRadius: "0.75rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function prevMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

export default function BudgetEditor({ farmSlug, categories }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incomeCategories = categories.filter((c) => c.type === "income");
  const expenseCategories = categories.filter((c) => c.type === "expense");

  const loadBudgets = useCallback(
    async (y: number, m: number, mode: "replace" | "prefill") => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/${farmSlug}/budgets?year=${y}&month=${m}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Failed to load budgets");
        const data = (await res.json()) as { records: BudgetRecord[] };
        const map: Record<string, string> = {};
        for (const r of data.records) {
          map[r.categoryName] = String(r.amount);
        }
        if (mode === "replace") {
          setAmounts(map);
        } else {
          setAmounts((prev) => {
            const merged = { ...prev };
            for (const [k, v] of Object.entries(map)) {
              if (!merged[k] || merged[k] === "" || merged[k] === "0") {
                merged[k] = v;
              }
            }
            return merged;
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [farmSlug],
  );

  useEffect(() => {
    if (!open) return;
    void loadBudgets(year, month, "replace");
  }, [open, year, month, loadBudgets]);

  const handleCopyPrevious = async () => {
    const prev = prevMonth(year, month);
    await loadBudgets(prev.year, prev.month, "prefill");
  };

  const handleChange = (name: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const ops: Promise<Response>[] = [];
      for (const cat of categories) {
        const raw = amounts[cat.name];
        if (raw === undefined || raw === "") continue;
        const amt = Number.parseFloat(raw);
        if (!Number.isFinite(amt) || amt < 0) continue;
        ops.push(
          fetch(`/api/${farmSlug}/budgets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year,
              month,
              categoryName: cat.name,
              type: cat.type,
              amount: amt,
            }),
          }),
        );
      }
      const results = await Promise.all(ops);
      const failure = results.find((r) => !r.ok);
      if (failure) {
        const body = await failure.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const renderColumn = (title: string, cats: Category[]) => (
    <div>
      <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
        {title}
      </h4>
      <div className="space-y-2">
        {cats.length === 0 && (
          <p className="text-xs" style={{ color: "#9C8E7A" }}>No categories.</p>
        )}
        {cats.map((cat) => (
          <div key={cat.id} className="flex items-center gap-2">
            <label className="flex-1 text-sm" style={{ color: "#1C1815" }}>{cat.name}</label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="0"
              value={amounts[cat.name] ?? ""}
              onChange={(e) => handleChange(cat.name, e.target.value)}
              style={{ ...fieldStyle, width: "9rem", textAlign: "right", fontFamily: "monospace" }}
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium rounded-lg px-3 py-1.5"
        style={{ background: "#3A6B49", color: "#FFFFFF" }}
      >
        Set Budgets
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div
            className="rounded-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold" style={{ color: "#1C1815" }}>
                Monthly Budget
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm"
                style={{ color: "#9C8E7A" }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[8rem]">
                <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Month</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number.parseInt(e.target.value, 10))}
                  style={fieldStyle}
                >
                  {MONTHS.map((label, idx) => (
                    <option key={label} value={idx + 1}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[6rem]">
                <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Year</label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number.parseInt(e.target.value, 10) || year)}
                  min={2000}
                  max={2100}
                  style={fieldStyle}
                />
              </div>
              <button
                type="button"
                onClick={handleCopyPrevious}
                disabled={loading || saving}
                className="text-xs font-medium rounded-lg px-3 py-2"
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E0D5C8",
                  color: "#1C1815",
                  opacity: loading || saving ? 0.5 : 1,
                }}
              >
                Copy from previous month
              </button>
            </div>

            {loading ? (
              <p className="text-sm" style={{ color: "#9C8E7A" }}>Loading…</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {renderColumn("Expenses", expenseCategories)}
                {renderColumn("Income", incomeCategories)}
              </div>
            )}

            {error && (
              <p className="text-sm" style={{ color: "#C0574C" }}>{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="text-sm rounded-lg px-4 py-2"
                style={{ background: "#FFFFFF", border: "1px solid #E0D5C8", color: "#1C1815" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || loading}
                className="text-sm font-medium rounded-lg px-4 py-2"
                style={{ background: "#3A6B49", color: "#FFFFFF", opacity: saving || loading ? 0.5 : 1 }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
