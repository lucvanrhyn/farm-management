"use client";

import { useState } from "react";

interface Category {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

interface ListProps {
  categories: Category[];
  type: "income" | "expense";
  onDelete: (id: string) => Promise<void>;
  onAdd: (name: string, type: "income" | "expense") => Promise<void>;
  deletingId: string | null;
  addingType: string | null;
}

function CategoryList({ categories, type, onDelete, onAdd, deletingId, addingType }: ListProps) {
  const [newVal, setNewVal] = useState("");
  const [error, setError] = useState("");

  async function handleAdd() {
    if (!newVal.trim()) return;
    setError("");
    try {
      await onAdd(newVal.trim(), type);
      setNewVal("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add.");
    }
  }

  const isIncome = type === "income";
  const chipColor = isIncome ? "#4A7C59" : "#A0522D";
  const chipBg = isIncome ? "rgba(74,124,89,0.15)" : "rgba(160,82,45,0.15)";

  return (
    <div className="space-y-2">
      <h3
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: chipColor }}
      >
        {isIncome ? "Income" : "Expenses"}
      </h3>
      <div className="flex flex-wrap gap-2 min-h-8">
        {categories.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
            style={{ background: chipBg, color: chipColor }}
          >
            {c.name}
            {!c.isDefault && (
              <button
                onClick={() => onDelete(c.id)}
                disabled={deletingId === c.id}
                className="hover:opacity-70 transition-opacity ml-0.5 font-bold"
                title="Delete category"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder={`Add ${isIncome ? "income" : "expense"} category...`}
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          className="flex-1 rounded-xl px-3 py-1.5 text-sm focus:outline-none"
          style={{
            background: "#FFFFFF",
            border: "1px solid #E0D5C8",
            color: "#1C1815",
          }}
        />
        <button
          onClick={handleAdd}
          disabled={addingType === `add-${type}` || !newVal.trim()}
          className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40 transition-colors"
          style={{
            background: "#F5F2EE",
            color: "#6B5C4E",
            border: "1px solid #E0D5C8",
          }}
        >
          ＋
        </button>
      </div>
      {error && <p className="text-xs" style={{ color: "#A0522D" }}>{error}</p>}
    </div>
  );
}

interface Props {
  incomeCategories: Category[];
  expenseCategories: Category[];
  onChanged: () => void;
}

export default function CategoryManager({ incomeCategories, expenseCategories, onChanged }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingType, setAddingType] = useState<string | null>(null);

  async function addCategory(name: string, type: "income" | "expense") {
    setAddingType(`add-${type}`);
    try {
      const res = await fetch("/api/transaction-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not add.");
      }
      onChanged();
    } finally {
      setAddingType(null);
    }
  }

  async function deleteCategory(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/transaction-categories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Could not delete.");
        return;
      }
      onChanged();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      className="rounded-2xl p-6 space-y-6"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <h2 className="text-sm font-semibold" style={{ color: "#6B5C4E" }}>Manage Categories</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CategoryList
          categories={incomeCategories}
          type="income"
          onDelete={deleteCategory}
          onAdd={addCategory}
          deletingId={deletingId}
          addingType={addingType}
        />
        <CategoryList
          categories={expenseCategories}
          type="expense"
          onDelete={deleteCategory}
          onAdd={addCategory}
          deletingId={deletingId}
          addingType={addingType}
        />
      </div>
    </div>
  );
}
