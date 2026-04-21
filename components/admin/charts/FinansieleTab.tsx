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
import type { FinansieleData } from "@/components/admin/charts/chart-types";

// ── Shared styles (dark/amber design language) ────────────────────────────────

const cardStyle = {
  background: "#241C14",
  border: "1px solid rgba(196,144,48,0.18)",
  borderRadius: "1rem",
  padding: "1.5rem",
};
const titleStyle = { fontWeight: 600, color: "#F0DEB8", marginBottom: "0.25rem" };
const subtitleStyle = { fontSize: "0.75rem", color: "#9C8473", marginBottom: "1rem" };
const emptyStyle = { fontSize: "0.875rem", color: "#9C8473", padding: "2rem 0", textAlign: "center" as const };
const gridStroke = "rgba(196,144,48,0.12)";
const tickStyle = { fill: "#9C8473", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "#1A1510",
  border: "1px solid rgba(196,144,48,0.3)",
  color: "#F0DEB8",
  fontSize: 12,
};

// ── Category colours for herd composition ────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Cow: "#C49030",
  Bull: "#3b82f6",
  Heifer: "#22c55e",
  Calf: "#f97316",
  Ox: "#a78bfa",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRand(value: number): string {
  return `R${value.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month ?? "1", 10) - 1]} ${year?.slice(2) ?? ""}`;
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

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

// ── SVG Donut chart for herd composition ─────────────────────────────────────

interface DonutSlice {
  label: string;
  count: number;
  color: string;
}

function DonutChart({ slices, total }: { slices: DonutSlice[]; total: number }) {
  const SIZE = 180;
  const CENTER = SIZE / 2;
  const RADIUS = 68;
  const INNER = 42;

  // Reduce accumulates the running `startAngle` without mutating a captured
  // variable during render — the React compiler flags mid-render reassignment
  // as non-idempotent.
  const paths = slices.reduce<
    { paths: Array<{ d: string; color: string; label: string; count: number }>; angle: number }
  >(
    (acc, slice) => {
      const fraction = slice.count / total;
      const sweepAngle = fraction * 2 * Math.PI;
      const startAngle = acc.angle;
      const endAngle = startAngle + sweepAngle;

      const x1 = CENTER + RADIUS * Math.cos(startAngle);
      const y1 = CENTER + RADIUS * Math.sin(startAngle);
      const x2 = CENTER + RADIUS * Math.cos(endAngle);
      const y2 = CENTER + RADIUS * Math.sin(endAngle);
      const xi1 = CENTER + INNER * Math.cos(startAngle);
      const yi1 = CENTER + INNER * Math.sin(startAngle);
      const xi2 = CENTER + INNER * Math.cos(endAngle);
      const yi2 = CENTER + INNER * Math.sin(endAngle);

      const largeArc = sweepAngle > Math.PI ? 1 : 0;

      const d = [
        `M ${xi1} ${yi1}`,
        `L ${x1} ${y1}`,
        `A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${x2} ${y2}`,
        `L ${xi2} ${yi2}`,
        `A ${INNER} ${INNER} 0 ${largeArc} 0 ${xi1} ${yi1}`,
        "Z",
      ].join(" ");

      return {
        paths: [...acc.paths, { d, color: slice.color, label: slice.label, count: slice.count }],
        angle: endAngle,
      };
    },
    { paths: [], angle: -Math.PI / 2 },
  ).paths;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
      <svg width={SIZE} height={SIZE} style={{ flexShrink: 0 }}>
        {paths.map((p) => (
          <path key={p.label} d={p.d} fill={p.color} opacity={0.9}>
            <title>{`${p.label}: ${p.count}`}</title>
          </path>
        ))}
        <text x={CENTER} y={CENTER - 7} textAnchor="middle" fill="#F0DEB8" fontSize={20} fontWeight={700}>
          {total}
        </text>
        <text x={CENTER} y={CENTER + 12} textAnchor="middle" fill="#9C8473" fontSize={10}>
          animals
        </text>
      </svg>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {slices.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem" }}>
            <span
              style={{
                display: "inline-block",
                width: "0.75rem",
                height: "0.75rem",
                borderRadius: "0.2rem",
                background: s.color,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#F0DEB8", fontWeight: 500 }}>{s.label}</span>
            <span style={{ color: "#9C8473", marginLeft: "auto", paddingLeft: "0.75rem" }}>
              {s.count} ({Math.round((s.count / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cover badge ───────────────────────────────────────────────────────────────

function DaysBadge({ days }: { days: number | null }) {
  if (days === null) {
    return <span style={{ color: "#9C8473", fontSize: "0.8rem" }}>—</span>;
  }

  const color = days < 7 ? "#ef4444" : days <= 14 ? "#f97316" : "#22c55e";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.6rem",
        borderRadius: "9999px",
        background: `${color}22`,
        color,
        fontWeight: 600,
        fontSize: "0.8rem",
        border: `1px solid ${color}44`,
      }}
    >
      {Math.round(days)} days
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FinansieleTab({ data }: { data: FinansieleData }) {
  const { financialTrend, herdComposition, campCover } = data;

  // ── 1. Financial trend ────────────────────────────────────────────────────
  const trendChartData = financialTrend.map((m) => ({
    month: formatMonth(m.month),
    income: m.income,
    expense: m.expense,
    net: m.income - m.expense,
  }));

  // ── 2. Herd composition ───────────────────────────────────────────────────
  const totalAnimals = herdComposition.reduce((s, c) => s + c.count, 0);
  const donutSlices: DonutSlice[] = herdComposition.map((c) => ({
    label: c.category,
    count: c.count,
    color: CATEGORY_COLORS[c.category] ?? "#94a3b8",
  }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* 1. Income vs Expense bar chart */}
      <div className="xl:col-span-2">
        <ChartCard
          title="Monthly Income vs Expenses"
          subtitle="Last 6 months — all transactions"
        >
          {trendChartData.length === 0 ? (
            <Empty message="No transactions recorded in the last 6 months" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trendChartData} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="month" tick={tickStyle} />
                <YAxis
                  tick={tickStyle}
                  tickFormatter={(v) => `R${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: unknown, name: unknown) => [
                    formatRand(typeof value === "number" ? value : 0),
                    name === "income" ? "Income" : name === "expense" ? "Expenses" : "Net",
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: "#9C8473", paddingTop: "0.5rem" }}
                  formatter={(value) =>
                    value === "income" ? "Income" : value === "expense" ? "Expenses" : "Net"
                  }
                />
                <Bar dataKey="income" fill="#22c55e" name="income" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" fill="#C49030" name="expense" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* 2. Herd composition */}
      <ChartCard
        title="Herd Composition"
        subtitle="Active animals by category"
      >
        {totalAnimals === 0 ? (
          <Empty message="No active animals" />
        ) : (
          <DonutChart slices={donutSlices} total={totalAnimals} />
        )}
      </ChartCard>

      {/* 3. Camp cover overview */}
      <ChartCard
        title="Camp Cover Overview"
        subtitle="Latest cover reading & days grazing remaining"
      >
        {campCover.length === 0 ? (
          <Empty message="No camp cover readings recorded" />
        ) : (
          <div style={{ overflowY: "auto", maxHeight: "16rem" }}>
            <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ fontSize: "0.75rem", color: "#9C8473", borderBottom: "1px solid rgba(196,144,48,0.18)" }}>
                  <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Camp</th>
                  <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Cover</th>
                  <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>kg DM/ha</th>
                  <th style={{ textAlign: "left", paddingBottom: "0.5rem", fontWeight: 500 }}>Recorded</th>
                  <th style={{ textAlign: "right", paddingBottom: "0.5rem", fontWeight: 500 }}>Days left</th>
                </tr>
              </thead>
              <tbody>
                {campCover.map((c) => (
                  <tr
                    key={c.campId}
                    style={{ borderBottom: "1px solid rgba(196,144,48,0.1)" }}
                  >
                    <td style={{ padding: "0.5rem 0", color: "#F0DEB8", fontWeight: 500 }}>{c.campName}</td>
                    <td style={{ padding: "0.5rem 0", color: "#9C8473" }}>{c.coverCategory}</td>
                    <td style={{ padding: "0.5rem 0", color: "#9C8473" }}>{c.kgDmPerHa.toFixed(0)}</td>
                    <td style={{ padding: "0.5rem 0", color: "#9C8473", fontSize: "0.75rem" }}>
                      {c.recordedAt}
                    </td>
                    <td style={{ padding: "0.5rem 0", textAlign: "right" }}>
                      <DaysBadge days={c.daysGrazingRemaining} />
                    </td>
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
