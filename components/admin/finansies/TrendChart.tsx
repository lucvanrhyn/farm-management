"use client";

import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Transaction {
  id: string;
  type: string;
  amount: number;
  date: string;
}

interface Props {
  transactions: Transaction[];
}

type Period = "week" | "month" | "year";

function formatPeriodKey(date: Date, period: Period): string {
  if (period === "year") return String(date.getFullYear());
  if (period === "month") {
    return date.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
  }
  // week: ISO week
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `Wk ${weekNum}`;
}

function sortKey(date: Date, period: Period): string {
  if (period === "year") return String(date.getFullYear());
  if (period === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-${String(weekNum).padStart(2, "0")}`;
}

export default function TrendChart({ transactions }: Props) {
  const [period, setPeriod] = useState<Period>("month");

  const data = useMemo(() => {
    const map = new Map<string, { label: string; sortable: string; income: number; expense: number }>();

    for (const tx of transactions) {
      const d = new Date(tx.date);
      const label = formatPeriodKey(d, period);
      const sk = sortKey(d, period);
      if (!map.has(sk)) map.set(sk, { label, sortable: sk, income: 0, expense: 0 });
      const entry = map.get(sk)!;
      if (tx.type === "income") entry.income += tx.amount;
      else entry.expense += tx.amount;
    }

    return Array.from(map.values())
      .sort((a, b) => a.sortable.localeCompare(b.sortable))
      .map(({ label, income, expense }) => ({ label, income, expense }));
  }, [transactions, period]);

  const formatRand = (v: number) => `R${v.toLocaleString("en-ZA", { minimumFractionDigits: 0 })}`;

  return (
    <div
      className="rounded-2xl p-6"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: "#6B5C4E" }}>
          Income vs Expenses
        </h2>
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "rgba(122,92,30,0.08)" }}>
          {(["week", "month", "year"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{
                background: period === p ? "#FFFFFF" : "transparent",
                color: period === p ? "#1C1815" : "#9C8E7A",
                boxShadow: period === p ? "0 1px 3px rgba(0,0,0,0.1)" : undefined,
              }}
            >
              {p === "week" ? "Weekly" : p === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-center py-12" style={{ color: "#9C8E7A" }}>
          No transactions.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0D5C8" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9C8E7A" }} />
            <YAxis
              tickFormatter={(v) => `R${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11, fill: "#9C8E7A" }}
            />
            <Tooltip
              contentStyle={{ background: "#1A1510", border: "1px solid rgba(139,105,20,0.3)", borderRadius: 8 }}
              labelStyle={{ color: "#F5EBD4" }}
              itemStyle={{ color: "rgba(210,180,140,0.85)" }}
              formatter={(value, name) => [
                formatRand(Number(value)),
                name === "income" ? "Income" : "Expenses",
              ]}
            />
            <Legend formatter={(v) => (v === "income" ? "Income" : "Expenses")} wrapperStyle={{ color: "#6B5C4E" }} />
            <Bar dataKey="income" fill="#4A7C59" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" fill="#A0522D" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
