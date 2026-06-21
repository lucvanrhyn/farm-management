"use client";

import { useState, useEffect } from "react";
import ModalHeader from "@/components/ui/ModalHeader";
import AnimalPicker from "@/components/observations/AnimalPicker";

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
  campId?: string | null;
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
  /** Camp list for the optional camp <select>. When absent/empty the select is hidden. */
  camps?: { camp_id: string; camp_name: string }[];
  /** Farm mode/species — forwarded to AnimalPicker to scope its search. Optional. */
  species?: string | null;
  /** Pre-tag the transaction to this animal (fast-follow: animal-detail Investment tab). */
  animalId?: string;
}

const LIVESTOCK_CATEGORIES = ["Animal Sales", "Animal Purchases"];

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

export default function TransactionModal({
  transaction,
  incomeCategories,
  expenseCategories,
  onClose,
  onSaved,
  camps,
  species,
  animalId: injectedAnimalId,
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

  // Optional taggers — feed mechanism for per-animal / per-camp profitability.
  // `animalId` is the business TAG (e.g. "B042"), not a cuid. Injected prop
  // pre-tags the modal when opened from the animal-detail Investment tab.
  const [animalId, setAnimalId] = useState(transaction?.animalId ?? injectedAnimalId ?? "");
  const [campId, setCampId] = useState(transaction?.campId ?? "");

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
        animalId: animalId || null,
        campId: campId || null,
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
        style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
      >
        <ModalHeader
          title={isEdit ? "Edit Transaction" : "New Transaction"}
          onClose={onClose}
          titleStyle={{ color: "var(--ft-text)" }}
          closeStyle={{ color: "var(--ft-muted)" }}
        />
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
              Income
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
              Expense
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

          {/* Animal tagger (optional) — searchable, in-tenant. onChange yields the
              business tag (e.g. "B042"), exactly what Transaction.animalId stores. */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>
              Animal (optional)
            </label>
            <AnimalPicker
              species={species}
              value={animalId}
              onChange={setAnimalId}
              campId={campId || undefined}
            />
          </div>

          {/* Camp tagger (optional) — feed/lick/dip allocation across the camp's animals. */}
          {camps && camps.length > 0 && (
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>
                Camp (optional)
              </label>
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

          {/* Foreign-derived flag — drives SARS source code 0192/0193 on the ITR12. */}
          <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: "var(--ft-text)" }}>
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
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ft-good)" }}>
                Livestock Details
              </p>

              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Sale Type</label>
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
                <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>
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
                  <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Number of Animals</label>
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
                  <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Avg Mass (kg)</label>
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
                <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Transport Cost (R)</label>
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
                  <label className="text-xs mb-1 block" style={{ color: "var(--ft-subtle)" }}>Auction Fees (R)</label>
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

          {error && <p className="text-sm" style={{ color: "var(--ft-poor)" }}>{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm transition-colors"
              style={{
                border: "1px solid var(--ft-border)",
                color: "var(--ft-muted)",
                background: "transparent",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
              style={{ background: "var(--ft-good)", color: "var(--ft-fair-bg)" }}
            >
              {loading ? "Saving..." : isEdit ? "Save Changes" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
