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

  return (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Toolbar */}
      <div className="p-4 border-b border-stone-100 flex flex-wrap gap-3 items-center">
        <h2 className="text-sm font-semibold text-stone-700 mr-2">Transactions</h2>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border border-stone-300 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expenses</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border border-stone-300 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">All categories</option>
          {allCategories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="border border-stone-300 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <span className="text-stone-400 text-sm">–</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="border border-stone-300 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <button
          onClick={() => setModal("add")}
          className="ml-auto px-4 py-1.5 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700"
        >
          ＋ Add
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-sm text-stone-400 text-center py-12">No transactions found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-stone-600 text-xs uppercase tracking-wide">
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
                <tr key={tx.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                  <td className="px-4 py-3 text-stone-600 whitespace-nowrap">
                    {new Date(tx.date).toLocaleDateString("en-ZA")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      tx.type === "income" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {tx.type === "income" ? "Income" : "Expense"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-700">{tx.category}</td>
                  <td className="px-4 py-3 text-stone-500 max-w-xs truncate">{tx.description}</td>
                  <td className="px-4 py-3">
                    {tx.animalId && (
                      <Link
                        href={`/admin/animals/${tx.animalId}`}
                        className="font-mono text-xs text-green-700 hover:underline"
                      >
                        {tx.animalId}
                      </Link>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${
                    tx.type === "income" ? "text-green-700" : "text-red-600"
                  }`}>
                    {tx.type === "expense" ? "−" : "+"}{formatRand(tx.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setModal(tx)}
                        className="text-stone-400 hover:text-stone-700 text-xs"
                        title="Edit"
                      >
                        ✏️
                      </button>
                      {confirmDelete === tx.id ? (
                        <span className="flex gap-1">
                          <button
                            onClick={() => deleteTransaction(tx.id)}
                            disabled={deleting === tx.id}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            {deleting === tx.id ? "..." : "Yes"}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs text-stone-400 hover:text-stone-600"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(tx.id)}
                          className="text-stone-400 hover:text-red-500 text-xs"
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
