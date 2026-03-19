"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import TransactionModal from "./TransactionModal";

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
  transactions: Transaction[];
  incomeCategories: Category[];
  expenseCategories: Category[];
  onChanged: () => void;
}

export default function TransactionLedger({
  transactions,
  incomeCategories,
  expenseCategories,
  onChanged,
}: Props) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [modal, setModal] = useState<"add" | Transaction | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const allCategories = useMemo(
    () => [...incomeCategories, ...expenseCategories],
    [incomeCategories, expenseCategories]
  );

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (categoryFilter !== "all" && tx.category !== categoryFilter) return false;
      if (fromDate && tx.date < fromDate) return false;
      if (toDate && tx.date > toDate) return false;
      return true;
    });
  }, [transactions, typeFilter, categoryFilter, fromDate, toDate]);

  async function deleteTransaction(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setConfirmDelete(null);
      onChanged();
    } catch {
      alert("Could not delete. Try again.");
    } finally {
      setDeleting(null);
    }
  }

  function formatRand(amount: number) {
    return `R${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const lightSelect = {
    background: "#FFFFFF",
    border: "1px solid #E0D5C8",
    color: "#1C1815",
    borderRadius: "0.75rem",
    padding: "0.375rem 0.75rem",
    fontSize: "0.875rem",
    outline: "none",
  } as React.CSSProperties;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      {/* Toolbar */}
      <div
        className="p-4 flex flex-wrap gap-3 items-center"
        style={{ borderBottom: "1px solid #E0D5C8" }}
      >
        <h2 className="text-sm font-semibold mr-2" style={{ color: "#6B5C4E" }}>
          Transactions
        </h2>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={lightSelect}>
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expenses</option>
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={lightSelect}>
          <option value="all">All categories</option>
          {allCategories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          style={{ ...lightSelect, colorScheme: "light" }}
        />
        <span className="text-sm" style={{ color: "#9C8E7A" }}>–</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          style={{ ...lightSelect, colorScheme: "light" }}
        />
        <button
          onClick={() => setModal("add")}
          className="ml-auto px-4 py-1.5 rounded-xl text-sm font-medium transition-colors"
          style={{ background: "#4A7C59", color: "#F5EBD4" }}
        >
          ＋ Add
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-sm text-center py-12" style={{ color: "#9C8E7A" }}>
          No transactions found.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs uppercase tracking-wide"
                style={{
                  borderBottom: "1px solid #E0D5C8",
                  background: "#F5F2EE",
                  color: "#9C8E7A",
                }}
              >
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-left px-4 py-3">Animal</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => (
                <tr
                  key={tx.id}
                  className="transition-colors"
                  style={{ borderBottom: "1px solid #E0D5C8" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(122,92,30,0.05)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-xs" style={{ color: "#9C8E7A" }}>
                    {new Date(tx.date).toLocaleDateString("en-ZA")}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                      style={
                        tx.type === "income"
                          ? { background: "rgba(74,124,89,0.2)", color: "#4A7C59" }
                          : { background: "rgba(160,82,45,0.2)", color: "#A0522D" }
                      }
                    >
                      {tx.type === "income" ? "Income" : "Expense"}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: "#6B5C4E" }}>{tx.category}</td>
                  <td className="px-4 py-3 max-w-xs truncate" style={{ color: "#9C8E7A" }}>{tx.description}</td>
                  <td className="px-4 py-3">
                    {tx.animalId && (
                      <Link
                        href={`/admin/animals/${tx.animalId}`}
                        className="font-mono text-xs hover:underline"
                        style={{ color: "#8B6914" }}
                      >
                        {tx.animalId}
                      </Link>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-semibold tabular-nums"
                    style={{ color: tx.type === "income" ? "#4A7C59" : "#A0522D" }}
                  >
                    {tx.type === "expense" ? "−" : "+"}{formatRand(tx.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setModal(tx)}
                        className="text-xs transition-opacity hover:opacity-70"
                        style={{ color: "#9C8E7A" }}
                        title="Edit"
                      >
                        ✏️
                      </button>
                      {confirmDelete === tx.id ? (
                        <span className="flex gap-1">
                          <button
                            onClick={() => deleteTransaction(tx.id)}
                            disabled={deleting === tx.id}
                            className="text-xs font-medium"
                            style={{ color: "#8B3A3A" }}
                          >
                            {deleting === tx.id ? "..." : "Yes"}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs"
                            style={{ color: "#9C8E7A" }}
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(tx.id)}
                          className="text-xs transition-opacity hover:opacity-70"
                          style={{ color: "#9C8E7A" }}
                          title="Delete"
                        >
                          🗑️
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

      {/* Modal */}
      {modal && (
        <TransactionModal
          transaction={modal === "add" ? undefined : modal}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onChanged(); }}
        />
      )}
    </div>
  );
}
