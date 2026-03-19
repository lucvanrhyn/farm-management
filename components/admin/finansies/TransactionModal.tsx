"use client";

import { useState, useEffect } from "react";

interface Category {
  id: string;
  name: string;
  type: string;
}

interface Transaction {
  id: string;
  type: string;
  category: string;
  amount: number;
  date: string;
  description: string;
  animalId: string | null;
}

interface Props {
  transaction?: Transaction; // if provided = edit mode
  incomeCategories: Category[];
  expenseCategories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

const fieldStyle: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E0D5C8",
  color: "#1C1815",
  borderRadius: "0.75rem",
  padding: "0.5rem 1rem",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
};

export default function TransactionModal({
  transaction,
  incomeCategories,
  expenseCategories,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!transaction;
  const [type, setType] = useState<"income" | "expense">(
    (transaction?.type as "income" | "expense") ?? "expense"
  );
  const [category, setCategory] = useState(transaction?.category ?? "");
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [date, setDate] = useState(transaction?.date ?? new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState(transaction?.description ?? "");
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
      const url = isEdit ? `/api/transactions/${transaction!.id}` : "/api/transactions";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, category, amount: parseFloat(amount), date, description }),
      });
      if (!res.ok) throw new Error("Request failed");
      onSaved();
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div
        className="rounded-2xl w-full max-w-md p-6 space-y-4"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <h2 className="text-lg font-bold" style={{ color: "#1C1815" }}>
          {isEdit ? "Edit Transaction" : "New Transaction"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("income")}
              className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
              style={
                type === "income"
                  ? { background: "rgba(74,124,89,0.2)", border: "1px solid rgba(74,124,89,0.5)", color: "#4A7C59" }
                  : { background: "transparent", border: "1px solid #E0D5C8", color: "#9C8E7A" }
              }
            >
              Income
            </button>
            <button
              type="button"
              onClick={() => setType("expense")}
              className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
              style={
                type === "expense"
                  ? { background: "rgba(160,82,45,0.2)", border: "1px solid rgba(160,82,45,0.5)", color: "#A0522D" }
                  : { background: "transparent", border: "1px solid #E0D5C8", color: "#9C8E7A" }
              }
            >
              Expense
            </button>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Category *</label>
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
            <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Amount (R) *</label>
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
            <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ ...fieldStyle, colorScheme: "light" }}
              required
            />
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Description</label>
            <input
              type="text"
              placeholder="Short description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={fieldStyle}
            />
          </div>

          {error && <p className="text-sm" style={{ color: "#C0574C" }}>{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm transition-colors"
              style={{
                border: "1px solid #E0D5C8",
                color: "#6B5C4E",
                background: "transparent",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
              style={{ background: "#4A7C59", color: "#F5EBD4" }}
            >
              {loading ? "Saving..." : isEdit ? "Save Changes" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
