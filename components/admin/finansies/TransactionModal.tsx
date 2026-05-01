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
  saleType?: string | null;
  counterparty?: string | null;
  quantity?: number | null;
  avgMassKg?: number | null;
  fees?: number | null;
  transportCost?: number | null;
  animalIds?: string | null;
  isForeign?: boolean | null;
}

interface Props {
  transaction?: Transaction; // if provided = edit mode
  incomeCategories: Category[];
  expenseCategories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

const LIVESTOCK_CATEGORIES = ["Animal Sales", "Animal Purchases"];

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

  // Livestock fields
  const [saleType, setSaleType] = useState<"auction" | "private" | "">(
    (transaction?.saleType as "auction" | "private") ?? "private"
  );
  const [counterparty, setCounterparty] = useState(transaction?.counterparty ?? "");
  const [quantity, setQuantity] = useState(
    transaction?.quantity != null ? String(transaction.quantity) : ""
  );
  const [avgMassKg, setAvgMassKg] = useState(
    transaction?.avgMassKg != null ? String(transaction.avgMassKg) : ""
  );
  const [fees, setFees] = useState(
    transaction?.fees != null ? String(transaction.fees) : ""
  );
  const [transportCost, setTransportCost] = useState(
    transaction?.transportCost != null ? String(transaction.transportCost) : ""
  );
  const [isForeign, setIsForeign] = useState<boolean>(
    transaction?.isForeign === true,
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const categories = type === "income" ? incomeCategories : expenseCategories;
  const isLivestock = LIVESTOCK_CATEGORIES.includes(category);

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

      const payload: Record<string, unknown> = {
        type,
        category,
        amount: parseFloat(amount),
        date,
        description,
        isForeign,
      };

      if (isLivestock) {
        payload.saleType = saleType || "private";
        payload.counterparty = counterparty || null;
        payload.quantity = quantity ? parseInt(quantity, 10) : null;
        payload.avgMassKg = avgMassKg ? parseFloat(avgMassKg) : null;
        payload.transportCost = transportCost ? parseFloat(transportCost) : null;
        payload.fees = saleType === "auction" && fees ? parseFloat(fees) : null;
      } else {
        // Clear livestock fields when switching away from livestock category
        payload.saleType = null;
        payload.counterparty = null;
        payload.quantity = null;
        payload.avgMassKg = null;
        payload.fees = null;
        payload.transportCost = null;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        className="rounded-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto"
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

          {/* Foreign-derived flag — drives SARS source code 0192/0193 on the ITR12. */}
          <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: "#1C1815" }}>
            <input
              type="checkbox"
              checked={isForeign}
              onChange={(e) => setIsForeign(e.target.checked)}
            />
            <span>
              Foreign-derived income (Lesotho/Eswatini/cross-border) —
              SARS code 0192/0193 on the ITR12 Farming Schedule.
            </span>
          </label>

          {/* Livestock Details — shown only for Animal Sales / Animal Purchases */}
          {isLivestock && (
            <div
              className="space-y-3 rounded-xl p-4"
              style={{ background: "rgba(74,124,89,0.05)", border: "1px solid rgba(74,124,89,0.2)" }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#4A7C59" }}>
                Livestock Details
              </p>

              <div>
                <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Sale Type</label>
                <select
                  value={saleType}
                  onChange={(e) => setSaleType(e.target.value as "auction" | "private")}
                  style={{ ...fieldStyle, colorScheme: "light" }}
                >
                  <option value="private">Private Sale</option>
                  <option value="auction">Auction</option>
                </select>
              </div>

              <div>
                <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>
                  {category === "Animal Sales" ? "Buyer Name" : "Seller Name"}
                </label>
                <input
                  type="text"
                  placeholder={category === "Animal Sales" ? "Buyer name..." : "Seller name..."}
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                  style={fieldStyle}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Number of Animals</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Avg Mass (kg)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="0.0"
                    value={avgMassKg}
                    onChange={(e) => setAvgMassKg(e.target.value)}
                    style={fieldStyle}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Transport Cost (R)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={transportCost}
                  onChange={(e) => setTransportCost(e.target.value)}
                  style={fieldStyle}
                />
              </div>

              {saleType === "auction" && (
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "#9C8E7A" }}>Auction Fees (R)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={fees}
                    onChange={(e) => setFees(e.target.value)}
                    style={fieldStyle}
                  />
                </div>
              )}
            </div>
          )}

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
