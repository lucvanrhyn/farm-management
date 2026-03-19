"use client";

import { useState, useCallback, useMemo } from "react";
import TrendChart from "@/components/admin/finansies/TrendChart";
import TransactionLedger from "@/components/admin/finansies/TransactionLedger";
import CategoryManager from "@/components/admin/finansies/CategoryManager";

interface Category {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
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
  initialTransactions: Transaction[];
  initialIncome: Category[];
  initialExpense: Category[];
}

export default function FinansiesClient({
  initialTransactions,
  initialIncome,
  initialExpense,
}: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [incomeCategories, setIncomeCategories] = useState<Category[]>(initialIncome);
  const [expenseCategories, setExpenseCategories] = useState<Category[]>(initialExpense);

  const refreshTransactions = useCallback(async () => {
    const res = await fetch("/api/transactions");
    if (res.ok) setTransactions(await res.json());
  }, []);

  const refreshCategories = useCallback(async () => {
    const res = await fetch("/api/transaction-categories");
    if (res.ok) {
      const data = await res.json();
      setIncomeCategories(data.income);
      setExpenseCategories(data.expense);
    }
  }, []);

  // Summary: current month
  const { monthIncome, monthExpense } = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let income = 0;
    let expense = 0;
    for (const tx of transactions) {
      if (!tx.date.startsWith(ym)) continue;
      if (tx.type === "income") income += tx.amount;
      else expense += tx.amount;
    }
    return { monthIncome: income, monthExpense: expense };
  }, [transactions]);

  const net = monthIncome - monthExpense;

  function formatRand(v: number) {
    return `R${Math.abs(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const statsItems = [
    {
      label: "Income (this month)",
      value: formatRand(monthIncome),
      icon: "💰",
      color: "#4A7C59",
      bg: "rgba(74,124,89,0.12)",
    },
    {
      label: "Expenses (this month)",
      value: formatRand(monthExpense),
      icon: "📤",
      color: "#A0522D",
      bg: "rgba(160,82,45,0.12)",
    },
    {
      label: "Net (this month)",
      value: (net >= 0 ? "+" : "−") + formatRand(net),
      icon: net >= 0 ? "📈" : "📉",
      color: net >= 0 ? "#4A7C59" : "#A0522D",
      bg: net >= 0 ? "rgba(74,124,89,0.12)" : "rgba(160,82,45,0.12)",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Summary stats bar */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3">
          {statsItems.map((item, i) => (
            <div
              key={item.label}
              className="px-6 py-5"
              style={{
                borderRight: i < 2 ? "1px solid #E0D5C8" : undefined,
                borderBottom: "1px solid #E0D5C8",
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-base"
                  style={{ background: item.bg }}
                >
                  {item.icon}
                </span>
              </div>
              <div
                className="text-2xl font-mono font-semibold tabular-nums mb-1"
                style={{ color: item.color }}
              >
                {item.value}
              </div>
              <div className="text-xs" style={{ color: "#9C8E7A" }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trend chart */}
      <TrendChart transactions={transactions} />

      {/* Ledger */}
      <TransactionLedger
        transactions={transactions}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        onChanged={refreshTransactions}
      />

      {/* Category manager */}
      <CategoryManager
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        onChanged={refreshCategories}
      />
    </div>
  );
}
