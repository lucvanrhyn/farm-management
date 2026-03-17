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

  return (
    <div className="space-y-2">
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${type === "income" ? "text-green-700" : "text-red-600"}`}>
        {type === "income" ? "Income" : "Expenses"}
      </h3>
      <div className="flex flex-wrap gap-2 min-h-8">
        {categories.map((c) => (
          <span
            key={c.id}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
              type === "income" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
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
          placeholder={`Add ${type === "income" ? "income" : "expense"} category...`}
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          className="flex-1 border border-stone-300 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <button
          onClick={handleAdd}
          disabled={addingType === `add-${type}` || !newVal.trim()}
          className="px-3 py-1.5 rounded-xl bg-stone-100 text-stone-600 text-sm hover:bg-stone-200 disabled:opacity-40"
        >
          ＋
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
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
    <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm space-y-6">
      <h2 className="text-sm font-semibold text-stone-700">Manage Categories</h2>
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
