"use client";

import { useState, useEffect } from "react";

interface Category {
  id: string;
  name: string;
  type: string;
}

interface Camp {
  camp_id: string;
  camp_name: string;
}

interface Props {
  farmSlug: string;
  incomeCategories: Category[];
  expenseCategories: Category[];
  camps?: Camp[];
  onSuccess: () => void;
  onCancel?: () => void;
}

const fieldStyle: React.CSSProperties = {
  background: "var(--ft-surface)",
  border: "1px solid var(--ft-border)",
  color: "var(--ft-text)",
  borderRadius: "0.75rem",
  padding: "0.5rem 1rem",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
};

export default function TransactionForm({
  farmSlug,
  incomeCategories,
  expenseCategories,
  camps,
  onSuccess,
  onCancel,
}: Props) {
  const [type, setType] = useState<"income" | "expense">("expense");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [campId, setCampId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const categories = type === "income" ? incomeCategories : expenseCategories;

  useEffect(() => {
    const valid = categories.some((c) => c.name === category);
    if (!valid) setCategory(categories[0]?.name ?? "");
  }, [type, categories, category]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !amount || parseFloat(amount) <= 0 || !date) {
      setError("Please fill in all required fields.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/${farmSlug}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          category,
          amount: parseFloat(amount),
          date,
          description,
          campId: campId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Request failed");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Type toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setType("income")}
          className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
          style={
            type === "income"
              ? { background: "rgba(74,124,89,0.2)", border: "1px solid rgba(74,124,89,0.5)", color: "var(--ft-good)" }
              : { background: "transparent", border: "1px solid var(--ft-border)", color: "var(--ft-subtle)" }
          }
        >
          + Income
        </button>
        <button
          type="button"
          onClick={() => setType("expense")}
          className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
          style={
            type === "expense"
              ? { background: "rgba(160,82,45,0.2)", border: "1px solid rgba(160,82,45,0.5)", color: "var(--ft-poor)" }
              : { background: "transparent", border: "1px solid var(--ft-border)", color: "var(--ft-subtle)" }
          }
        >
          - Expense
        </button>
      </div>

      <div>
        <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Category *</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ ...fieldStyle, colorScheme: "light" }}
          required
        >
          <option value="">Select category...</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Amount (R) *</label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={fieldStyle}
          required
        />
      </div>

      <div>
        <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Date *</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ ...fieldStyle, colorScheme: "light" }}
          required
        />
      </div>

      <div>
        <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Description</label>
        <input
          type="text"
          placeholder="Short description..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={fieldStyle}
        />
      </div>

      {camps && camps.length > 0 && (
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Camp (optional)</label>
          <select
            value={campId}
            onChange={(e) => setCampId(e.target.value)}
            style={{ ...fieldStyle, colorScheme: "light" }}
          >
            <option value="">No camp</option>
            {camps.map((c) => (
              <option key={c.camp_id} value={c.camp_id}>{c.camp_name}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="text-sm" style={{ color: "var(--ft-poor)" }}>{error}</p>}

      <div className="flex gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl text-sm transition-colors"
            style={{ border: "1px solid var(--ft-border)", color: "var(--ft-muted)", background: "transparent" }}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-2 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
          style={{ background: "var(--ft-good)", color: "var(--ft-fair-bg)" }}
        >
          {loading ? "Saving..." : "Add Transaction"}
        </button>
      </div>
    </form>
  );
}
