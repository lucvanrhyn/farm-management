"use client";

import type { ReactNode } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { GrafiekeData } from "@/components/admin/GrafiekeClient";

const cardStyle = {
  background: "#FFFFFF",
  border: "1px solid #E0D5C8",
  borderRadius: "1rem",
  padding: "1.5rem",
};
const titleStyle = { fontWeight: 600, color: "#1C1815", marginBottom: "0.25rem" };
const subtitleStyle = { fontSize: "0.75rem", color: "#9C8E7A", marginBottom: "1rem" };
const emptyStyle = { fontSize: "0.875rem", color: "#9C8E7A", padding: "2rem 0", textAlign: "center" as const };
const gridStroke = "#E0D5C8";
const tickStyle = { fill: "#9C8E7A", fontSize: 11 };

// Tooltips stay dark for contrast on light background
const tooltipStyle = {
  backgroundColor: "#1A1510",
  border: "1px solid rgba(139,105,20,0.3)",
  color: "#F5EBD4",
  fontSize: 12,
};

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

function formatMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month, 10) - 1]} ${year?.slice(2)}`;
}

// Build per-camp line series for the herd ADG chart
function buildHerdAdgSeries(herdAdgTrend: GrafiekeData["herdAdgTrend"]) {
  // Collect all unique dates and camp names
  const dateSet = new Set<string>();
  const campSet = new Set<string>();
  for (const pt of herdAdgTrend) {
    dateSet.add(pt.weighDate);
    campSet.add(pt.campName);
  }
  const dates = Array.from(dateSet).sort();
  const campNames = Array.from(campSet);

  // Build one row per date with each camp's avg ADG as a column
  const rows: Record<string, string | number>[] = dates.map((date) => {
    const row: Record<string, string | number> = { date: date.slice(5) }; // MM-DD label
    for (const campName of campNames) {
      const pt = herdAdgTrend.find((p) => p.weighDate === date && p.campName === campName);
      if (pt) row[campName] = pt.avgAdg;
    }
    return row;
  });

  return { rows, campNames };
}

// Distinct colours for up to 10 camps
const CAMP_COLORS = [
  "#4A7C59", "#8B6914", "#C0574C", "#3b82f6", "#a855f7",
  "#f97316", "#06b6d4", "#84cc16", "#f43f5e", "#64748b",
];

export default function DiereTab({ data }: { data: GrafiekeData }) {
  const { calvings, attrition, withdrawals, herdAdgTrend } = data;

  const calvingChartData = calvings.map((c) => ({ ...c, month: formatMonth(c.month) }));
  const attritionChartData = attrition.map((a) => ({ ...a, month: formatMonth(a.month) }));
  const { rows: herdAdgRows, campNames } = buildHerdAdgSeries(herdAdgTrend);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* 1. Calving Trend */}
      <ChartCard title="Calving Trend" subtitle="Monthly calf registrations (last 12 months)">
        {calvingChartData.length === 0 ? (
          <Empty message="No calving records recorded" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={calvingChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="month" tick={tickStyle} />
              <YAxis tick={tickStyle} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, "Calvings"]} />
              <Bar dataKey="count" fill="#22c55e" name="Calvings" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 2. Deaths & Sales */}
      <ChartCard title="Deaths & Sales" subtitle="Monthly deductions (last 12 months)">
        {attritionChartData.length === 0 ? (
          <Empty message="No deaths or sales recorded" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={attritionChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="month" tick={tickStyle} />
              <YAxis tick={tickStyle} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#6B5C4E" }} />
              <Bar dataKey="deaths" fill="#ef4444" name="Deaths" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sales" fill="#3b82f6" name="Sales" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 3. Herd ADG Trend — full width */}
      <div className="xl:col-span-2">
        <ChartCard title="Herd ADG Trend" subtitle="Average daily gain per camp over time (last 12 months)">
          {herdAdgTrend.length === 0 ? (
            <Empty message="No weighing records found — log weighing sessions via the Logger" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={herdAdgRows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="date" tick={tickStyle} />
                <YAxis
                  tick={tickStyle}
                  tickFormatter={(v: number) => `${v} kg/d`}
                  width={60}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, name) => [typeof v === "number" ? `${v.toFixed(2)} kg/day` : String(v), String(name)]}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#6B5C4E" }} />
                <ReferenceLine
                  y={0.7}
                  stroke="#C0574C"
                  strokeDasharray="4 3"
                  label={{ value: "Poor doer threshold (0.7)", position: "insideTopRight", fill: "#C0574C", fontSize: 9 }}
                />
                {campNames.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={CAMP_COLORS[i % CAMP_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* 4. Withdrawal Tracker — full width */}
      <div className="xl:col-span-2">
        <ChartCard title="Treatment Withdrawal Period" subtitle="Animals not yet cleared for market">
          {withdrawals.length === 0 ? (
            <p style={{ ...emptyStyle, padding: "1rem 0" }}>
              ✅ No active withdrawal periods
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ fontSize: "0.75rem", color: "#9C8E7A", borderBottom: "1px solid #E0D5C8" }}>
                    <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Animal</th>
                    <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Camp</th>
                    <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Medicine</th>
                    <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Date Treated</th>
                    <th style={{ textAlign: "right", paddingBottom: "0.5rem", fontWeight: 500 }}>Days Left</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((w) => (
                    <tr
                      key={w.id}
                      style={{
                        borderBottom: "1px solid #E0D5C8",
                        background: w.daysRemaining <= 3 ? "rgba(139,20,20,0.06)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "0.5rem 0", fontFamily: "monospace", fontSize: "0.75rem", color: "#1C1815" }}>{w.animalId ?? "—"}</td>
                      <td style={{ padding: "0.5rem 0", color: "#6B5C4E" }}>{w.campId}</td>
                      <td style={{ padding: "0.5rem 0", color: "#1C1815", fontWeight: 500 }}>{w.drug}</td>
                      <td style={{ padding: "0.5rem 0", color: "#9C8E7A", fontSize: "0.75rem" }}>{w.observedAt}</td>
                      <td style={{
                        padding: "0.5rem 0",
                        textAlign: "right",
                        fontWeight: 600,
                        color: w.daysRemaining <= 3 ? "#C0574C" : "#1C1815",
                      }}>
                        {w.daysRemaining} days
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
