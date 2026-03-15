"use client";

import type { ReactNode } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { CAMPS } from "@/lib/dummy-data";
import type { GrafiekeData } from "@/components/admin/GrafiekeClient";

const CATEGORY_COLORS: Record<string, string> = {
  Cow: "#C4A030",
  Bull: "#3b82f6",
  Heifer: "#22c55e",
  Calf: "#f97316",
  Ox: "#a78bfa",
};

const CAMP_SIZES = new Map(CAMPS.map((c) => [c.camp_id, c.size_hectares]));

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

export default function KampeTab({ data }: { data: GrafiekeData }) {
  const { conditionTrend, healthByCamp, headcount, heatmap, movements } = data;

  // ── Stocking rate: headcount per camp / size_hectares ──
  const headcountByCamp = new Map<string, number>();
  for (const row of headcount) {
    headcountByCamp.set(row.campId, (headcountByCamp.get(row.campId) ?? 0) + row.count);
  }
  const stockingData = CAMPS.map((c) => ({
    campId: c.camp_id,
    lsu: headcountByCamp.has(c.camp_id)
      ? Math.round(((headcountByCamp.get(c.camp_id) ?? 0) / c.size_hectares) * 100) / 100
      : 0,
  })).filter((d) => d.lsu > 0);

  // ── Headcount stacked bar ──
  const allCategories = Array.from(new Set(headcount.map((h) => h.category)));
  const headcountByCampMap = new Map<string, Record<string, number>>();
  for (const row of headcount) {
    if (!headcountByCampMap.has(row.campId)) headcountByCampMap.set(row.campId, {});
    headcountByCampMap.get(row.campId)![row.category] = row.count;
  }
  const headcountChartData = Array.from(headcountByCampMap.entries()).map(([campId, cats]) => ({
    campId,
    ...cats,
  }));

  // ── Heatmap ──
  const heatmapCamps = Array.from(new Set(heatmap.map((h) => h.campId))).sort();
  const heatmapDates = Array.from(new Set(heatmap.map((h) => h.date))).sort().slice(-14); // last 14 days
  const heatmapLookup = new Map(heatmap.map((h) => [`${h.campId}__${h.date}`, h.count]));
  const maxCount = Math.max(1, ...heatmap.map((h) => h.count));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* 1. Camp Condition Trend */}
      <ChartCard title="Kamp Toestand Tendens" subtitle="Gemiddelde beweidingskwaliteit (laaste 30 dae)">
        {conditionTrend.length === 0 ? (
          <Empty message="Geen kamp-toestand data nie" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={conditionTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ece4" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis domain={[0, 4]} tick={{ fontSize: 11 }} tickFormatter={(v) => ["", "Oorblaai", "Swak", "Redelik", "Goed"][v] ?? v} />
              <Tooltip
                formatter={(v) => [["", "Oorblaai", "Swak", "Redelik", "Goed"][Math.round(Number(v))] ?? v, "Kwaliteit"]}
                labelFormatter={(l) => `Datum: ${String(l)}`}
              />
              <ReferenceLine y={3} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "Redelik", fontSize: 10, fill: "#22c55e" }} />
              <Line type="monotone" dataKey="avgScore" stroke="#C4A030" strokeWidth={2} dot={false} name="Gem. kwaliteit" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 2. Health Issues by Camp */}
      <ChartCard title="Gesondheidsinsidente per Kamp" subtitle="Laaste 30 dae">
        {healthByCamp.length === 0 ? (
          <Empty message="Geen gesondheidsinsidente aangeteken nie" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={healthByCamp} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ece4" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="campId" tick={{ fontSize: 11 }} width={80} />
              <Tooltip formatter={(v) => [v, "Insidente"]} />
              <Bar dataKey="count" fill="#ef4444" name="Insidente" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 3. Headcount per Camp */}
      <ChartCard title="Kopgetal per Kamp" subtitle="Aktiewe diere per kategorie">
        {headcountChartData.length === 0 ? (
          <Empty message="Geen aktiewe diere nie" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={headcountChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ece4" />
              <XAxis dataKey="campId" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {allCategories.map((cat) => (
                <Bar key={cat} dataKey={cat} stackId="a" fill={CATEGORY_COLORS[cat] ?? "#94a3b8"} name={cat} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 4. Stocking Rate */}
      <ChartCard title="Beweidingsdruk per Kamp" subtitle="Diere per hektaar (optimum ≈ 1 LSU/ha)">
        {stockingData.length === 0 ? (
          <Empty message="Geen data vir beweidingsdruk nie" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stockingData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ece4" />
              <XAxis dataKey="campId" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${v} LSU/ha`, "Beweidingsdruk"]} />
              <ReferenceLine y={1} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "Maks", fontSize: 10, fill: "#ef4444" }} />
              <Bar dataKey="lsu" name="LSU/ha" fill="#C4A030" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 5. Inspection Heatmap */}
      <ChartCard title="Inspeksie-hittegolf" subtitle="Kampe × dae (laaste 14 dae)">
        {heatmap.length === 0 ? (
          <Empty message="Geen inspeksiedata nie" />
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-1 text-stone-400 font-normal w-24">Kamp</th>
                  {heatmapDates.map((d) => (
                    <th key={d} className="p-1 text-stone-400 font-normal text-center w-7">
                      {d.slice(8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapCamps.map((campId) => (
                  <tr key={campId}>
                    <td className="p-1 text-stone-600 font-medium pr-3">{campId}</td>
                    {heatmapDates.map((date) => {
                      const count = heatmapLookup.get(`${campId}__${date}`) ?? 0;
                      const opacity = count === 0 ? 0.05 : 0.2 + (count / maxCount) * 0.8;
                      return (
                        <td key={date} className="p-0.5">
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: `rgba(74, 55, 40, ${opacity})` }}
                            title={`${campId} – ${date}: ${count} inspeksies`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {/* 6. Movement Table */}
      <ChartCard title="Dierbeweging" subtitle="Laaste 30 dae">
        {movements.length === 0 ? (
          <Empty message="Geen bewegings aangeteken nie" />
        ) : (
          <div className="overflow-y-auto max-h-56">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-stone-400 border-b border-stone-100">
                  <th className="text-left pb-2 font-medium">Datum</th>
                  <th className="text-left pb-2 font-medium">Dier</th>
                  <th className="text-left pb-2 font-medium">Van</th>
                  <th className="text-left pb-2 font-medium">Na</th>
                  <th className="text-left pb-2 font-medium">Aangeteken deur</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-stone-50 last:border-0">
                    <td className="py-2 text-stone-500 text-xs">{m.date}</td>
                    <td className="py-2 font-mono text-xs text-stone-700">{m.animalId ?? "—"}</td>
                    <td className="py-2 text-stone-600">{m.fromCamp}</td>
                    <td className="py-2 text-stone-600">→ {m.toCamp}</td>
                    <td className="py-2 text-stone-400 text-xs">{m.loggedBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
