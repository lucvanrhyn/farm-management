"use client";

import { useState, useCallback, useMemo } from "react";
import StatsCard from "@/components/admin/StatsCard";
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

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard
          label="Income (this month)"
          value={formatRand(monthIncome)}
          icon="💰"
          color="green"
        />
        <StatsCard
          label="Expenses (this month)"
          value={formatRand(monthExpense)}
          icon="📤"
          color="red"
        />
        <StatsCard
          label="Net (this month)"
          value={(net >= 0 ? "+" : "−") + formatRand(net)}
          icon={net >= 0 ? "📈" : "📉"}
          color={net >= 0 ? "green" : "red"}
        />
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
