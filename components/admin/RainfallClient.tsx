"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import RainfallEntryForm from "./RainfallEntryForm";

interface RainfallRecord {
  id: string;
  date: string;
  rainfallMm: number;
  stationName: string | null;
  campId: string | null;
}

interface MonthlyTotal {
  month: string;
  totalMm: number;
}

interface CampInfo {
  camp_id: string;
  camp_name: string;
}

interface Props {
  farmSlug: string;
  records: RainfallRecord[];
  monthlySummary: MonthlyTotal[];
  camps: CampInfo[];
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${names[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

function formatDate(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function RainfallClient({
  farmSlug,
  records,
  monthlySummary,
  camps,
}: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  const campMap = new Map(camps.map((c) => [c.camp_id, c.camp_name]));

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this rainfall record?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/${farmSlug}/rainfall?id=${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  const chartData = monthlySummary.map((m) => ({
    ...m,
    label: formatMonth(m.month),
  }));

  const totalMm = records.reduce((sum, r) => sum + r.rainfallMm, 0);

  return (
    <div className="space-y-6">
      <RainfallEntryForm farmSlug={farmSlug} camps={camps} />

      {/* Monthly totals chart */}
      {chartData.length > 0 && (
        <div
          className="rounded-xl p-4 md:p-6"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <h3
            className="text-sm font-semibold mb-1"
            style={{ color: "#1C1815" }}
          >
            Monthly Rainfall
          </h3>
          <p className="text-xs mb-4" style={{ color: "#9C8E7A" }}>
            {records.length} records &middot;{" "}
            {Math.round(totalMm * 10) / 10} mm total
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#9C8E7A" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#9C8E7A" }}
                axisLine={false}
                tickLine={false}
                unit=" mm"
                width={50}
              />
              <Tooltip
                contentStyle={{
                  background: "#FFFFFF",
                  border: "1px solid #E0D5C8",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: unknown) => [`${value} mm`, "Rainfall"]}
              />
              <Bar
                dataKey="totalMm"
                fill="#4A90D9"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent records table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <div className="p-4 md:px-6 md:pt-5">
          <h3
            className="text-sm font-semibold"
            style={{ color: "#1C1815" }}
          >
            Recent Records
          </h3>
        </div>

        {records.length === 0 ? (
          <p
            className="px-4 md:px-6 pb-5 text-sm"
            style={{ color: "#9C8E7A" }}
          >
            No rainfall records yet. Click &ldquo;+ Record Rainfall&rdquo; to
            add one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid #E0D5C8" }}>
                  {["Date", "Camp", "mm", "Station", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 md:px-6 py-2 text-left font-medium"
                      style={{ color: "#9C8E7A", fontSize: 11 }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr
                    key={r.id}
                    style={{
                      background: i % 2 === 0 ? "#FAFAF8" : "#FFFFFF",
                      borderBottom: "1px solid #F0EBE3",
                    }}
                  >
                    <td
                      className="px-4 md:px-6 py-2.5"
                      style={{ color: "#1C1815" }}
                    >
                      {formatDate(r.date)}
                    </td>
                    <td
                      className="px-4 md:px-6 py-2.5"
                      style={{ color: "#6B5C4E" }}
                    >
                      {r.campId ? campMap.get(r.campId) ?? r.campId : "Farm-wide"}
                    </td>
                    <td
                      className="px-4 md:px-6 py-2.5 font-medium"
                      style={{ color: "#4A90D9" }}
                    >
                      {r.rainfallMm}
                    </td>
                    <td
                      className="px-4 md:px-6 py-2.5"
                      style={{ color: "#9C8E7A" }}
                    >
                      {r.stationName ?? "\u2014"}
                    </td>
                    <td className="px-4 md:px-6 py-2.5 text-right">
                      <button
                        onClick={() => handleDelete(r.id)}
                        disabled={deleting === r.id}
                        className="text-xs transition-opacity hover:opacity-70 disabled:opacity-40"
                        style={{ color: "#C0574C" }}
                      >
                        {deleting === r.id ? "\u2026" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
