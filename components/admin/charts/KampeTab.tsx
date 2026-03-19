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

const cardStyle = {
  background: "#241C14",
  border: "1px solid rgba(139,105,20,0.18)",
  borderRadius: "1rem",
  padding: "1.5rem",
};
const titleStyle = { fontWeight: 600, color: "#F5EBD4", marginBottom: "0.25rem" };
const subtitleStyle = { fontSize: "0.75rem", color: "rgba(210,180,140,0.55)", marginBottom: "1rem" };
const emptyStyle = { fontSize: "0.875rem", color: "rgba(210,180,140,0.55)", padding: "2rem 0", textAlign: "center" as const };
const gridStroke = "rgba(139,105,20,0.15)";
const tickStyle = { fill: "rgba(210,180,140,0.55)", fontSize: 11 };

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div style={cardStyle}>
      <h2 style={titleStyle}>{title}</h2>
      {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
      <div style={{ marginTop: "0.75rem" }}>{children}</div>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return <p style={emptyStyle}>{message}</p>;
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
      ? Math.round(((headcountByCamp.get(c.camp_id) ?? 0) / (c.size_hectares ?? 1)) * 100) / 100
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
  const heatmapDates = Array.from(new Set(heatmap.map((h) => h.date))).sort().slice(-14);
  const heatmapLookup = new Map(heatmap.map((h) => [`${h.campId}__${h.date}`, h.count]));
  const maxCount = Math.max(1, ...heatmap.map((h) => h.count));

  const tooltipStyle = {
    backgroundColor: "#1A1510",
    border: "1px solid rgba(139,105,20,0.3)",
    color: "#F5EBD4",
    fontSize: 12,
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* 1. Camp Condition Trend */}
      <ChartCard title="Camp Condition Trend" subtitle="Average grazing quality (last 30 days)">
        {conditionTrend.length === 0 ? (
          <Empty message="No camp condition data" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={conditionTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="date" tick={tickStyle} tickFormatter={(v) => v.slice(5)} />
              <YAxis domain={[0, 4]} tick={tickStyle} tickFormatter={(v) => ["", "Overgrazed", "Poor", "Fair", "Good"][v] ?? v} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [["", "Overgrazed", "Poor", "Fair", "Good"][Math.round(Number(v))] ?? v, "Quality"]}
                labelFormatter={(l) => `Date: ${String(l)}`}
              />
              <ReferenceLine y={3} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "Fair", fontSize: 10, fill: "#22c55e" }} />
              <Line type="monotone" dataKey="avgScore" stroke="#C4A030" strokeWidth={2} dot={false} name="Avg. quality" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 2. Health Issues by Camp */}
      <ChartCard title="Health Incidents per Camp" subtitle="Last 30 days">
        {healthByCamp.length === 0 ? (
          <Empty message="No health incidents recorded" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={healthByCamp} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
              <XAxis type="number" tick={tickStyle} allowDecimals={false} />
              <YAxis type="category" dataKey="campId" tick={tickStyle} width={80} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, "Incidents"]} />
              <Bar dataKey="count" fill="#ef4444" name="Incidents" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 3. Headcount per Camp */}
      <ChartCard title="Headcount per Camp" subtitle="Active animals per category">
        {headcountChartData.length === 0 ? (
          <Empty message="No active animals" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={headcountChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="campId" tick={{ ...tickStyle, fontSize: 10 }} />
              <YAxis tick={tickStyle} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: "rgba(210,180,140,0.75)" }} />
              {allCategories.map((cat) => (
                <Bar key={cat} dataKey={cat} stackId="a" fill={CATEGORY_COLORS[cat] ?? "#94a3b8"} name={cat} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 4. Stocking Rate */}
      <ChartCard title="Grazing Pressure per Camp" subtitle="Animals per hectare (optimum ≈ 1 LSU/ha)">
        {stockingData.length === 0 ? (
          <Empty message="No data for grazing pressure" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stockingData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="campId" tick={{ ...tickStyle, fontSize: 10 }} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} LSU/ha`, "Grazing pressure"]} />
              <ReferenceLine y={1} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "Max", fontSize: 10, fill: "#ef4444" }} />
              <Bar dataKey="lsu" name="LSU/ha" fill="#C4A030" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 5. Inspection Heatmap */}
      <ChartCard title="Inspection Heatmap" subtitle="Camps × days (last 14 days)">
        {heatmap.length === 0 ? (
          <Empty message="No inspection data" />
        ) : (
          <div className="overflow-x-auto">
            <table style={{ fontSize: "0.75rem", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.25rem", color: "rgba(210,180,140,0.55)", fontWeight: 400, width: "6rem" }}>Camp</th>
                  {heatmapDates.map((d) => (
                    <th key={d} style={{ padding: "0.25rem", color: "rgba(210,180,140,0.55)", fontWeight: 400, textAlign: "center", width: "1.75rem" }}>
                      {d.slice(8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapCamps.map((campId) => (
                  <tr key={campId}>
                    <td style={{ padding: "0.25rem", color: "rgba(210,180,140,0.75)", fontWeight: 500, paddingRight: "0.75rem" }}>{campId}</td>
                    {heatmapDates.map((date) => {
                      const count = heatmapLookup.get(`${campId}__${date}`) ?? 0;
                      const opacity = count === 0 ? 0.05 : 0.2 + (count / maxCount) * 0.8;
                      return (
                        <td key={date} style={{ padding: "0.125rem" }}>
                          <div
                            style={{
                              width: "1.5rem",
                              height: "1.5rem",
                              borderRadius: "0.25rem",
                              backgroundColor: `rgba(139,105,20,${opacity})`,
                            }}
                            title={`${campId} – ${date}: ${count} inspections`}
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
      <ChartCard title="Animal Movement" subtitle="Last 30 days">
        {movements.length === 0 ? (
          <Empty message="No movements recorded" />
        ) : (
          <div style={{ overflowY: "auto", maxHeight: "14rem" }}>
            <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ fontSize: "0.75rem", color: "rgba(210,180,140,0.55)", borderBottom: "1px solid rgba(139,105,20,0.12)" }}>
                  <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Date</th>
                  <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Animal</th>
                  <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>From</th>
                  <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>To</th>
                  <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Logged by</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid rgba(139,105,20,0.08)" }}>
                    <td style={{ padding: "0.5rem 0", color: "rgba(210,180,140,0.55)", fontSize: "0.75rem" }}>{m.date}</td>
                    <td style={{ padding: "0.5rem 0", fontFamily: "monospace", fontSize: "0.75rem", color: "#F5EBD4" }}>{m.animalId ?? "—"}</td>
                    <td style={{ padding: "0.5rem 0", color: "rgba(210,180,140,0.75)" }}>{m.fromCamp}</td>
                    <td style={{ padding: "0.5rem 0", color: "rgba(210,180,140,0.75)" }}>→ {m.toCamp}</td>
                    <td style={{ padding: "0.5rem 0", color: "rgba(210,180,140,0.45)", fontSize: "0.75rem" }}>{m.loggedBy ?? "—"}</td>
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
