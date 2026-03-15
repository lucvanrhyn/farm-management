"use client";

import type { ReactNode } from "react";
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
import type { GrafiekeData } from "@/components/admin/GrafiekeClient";

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
      <h2 className="font-semibold text-stone-700 mb-1">{title}</h2>
      {subtitle && <p className="text-xs text-stone-400 mb-4">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="text-sm text-stone-400 py-8 text-center">{message}</p>;
}

function formatMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"];
  return `${months[parseInt(month, 10) - 1]} ${year?.slice(2)}`;
}

export default function DiereTab({ data }: { data: GrafiekeData }) {
  const { calvings, attrition, withdrawals } = data;

  const calvingChartData = calvings.map((c) => ({ ...c, month: formatMonth(c.month) }));
  const attritionChartData = attrition.map((a) => ({ ...a, month: formatMonth(a.month) }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* 1. Calving Trend */}
      <ChartCard title="Kalwingstendens" subtitle="Maandelikse kalf-aanmeldinge (laaste 12 maande)">
        {calvingChartData.length === 0 ? (
          <Empty message="Geen kalwingsrekords aangeteken nie" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={calvingChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ece4" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [v, "Kalwings"]} />
              <Bar dataKey="count" fill="#22c55e" name="Kalwings" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 2. Deaths & Sales */}
      <ChartCard title="Sterftes & Verkope" subtitle="Maandelikse aftrekking (laaste 12 maande)">
        {attritionChartData.length === 0 ? (
          <Empty message="Geen sterftes of verkope aangeteken nie" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={attritionChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ece4" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="deaths" fill="#ef4444" name="Sterftes" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sales" fill="#3b82f6" name="Verkope" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 3. Withdrawal Tracker — full width */}
      <div className="xl:col-span-2">
        <ChartCard title="Behandeling Onttrekkingsperiode" subtitle="Diere wat nog nie na mark mag nie">
          {withdrawals.length === 0 ? (
            <p className="text-sm text-stone-400 py-4 text-center">
              ✅ Geen aktiewe onttrekkingsperiodes nie
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-stone-400 border-b border-stone-100">
                    <th className="text-left pb-2 font-medium">Dier</th>
                    <th className="text-left pb-2 font-medium">Kamp</th>
                    <th className="text-left pb-2 font-medium">Medisyne</th>
                    <th className="text-left pb-2 font-medium">Datum Behandel</th>
                    <th className="text-right pb-2 font-medium">Dae Oor</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((w) => (
                    <tr
                      key={w.id}
                      className={`border-b border-stone-50 last:border-0 ${
                        w.daysRemaining <= 3 ? "bg-red-50" : ""
                      }`}
                    >
                      <td className="py-2 font-mono text-xs text-stone-700">{w.animalId ?? "—"}</td>
                      <td className="py-2 text-stone-600">{w.campId}</td>
                      <td className="py-2 text-stone-700 font-medium">{w.drug}</td>
                      <td className="py-2 text-stone-500 text-xs">{w.observedAt}</td>
                      <td className={`py-2 text-right font-semibold ${w.daysRemaining <= 3 ? "text-red-600" : "text-stone-700"}`}>
                        {w.daysRemaining} dae
                        {w.daysRemaining <= 3 && " ⚠️"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
