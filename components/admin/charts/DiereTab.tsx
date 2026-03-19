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

export default function DiereTab({ data }: { data: GrafiekeData }) {
  const { calvings, attrition, withdrawals } = data;

  const calvingChartData = calvings.map((c) => ({ ...c, month: formatMonth(c.month) }));
  const attritionChartData = attrition.map((a) => ({ ...a, month: formatMonth(a.month) }));

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
              <Legend wrapperStyle={{ fontSize: 11, color: "rgba(210,180,140,0.75)" }} />
              <Bar dataKey="deaths" fill="#ef4444" name="Deaths" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sales" fill="#3b82f6" name="Sales" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 3. Withdrawal Tracker — full width */}
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
                  <tr style={{ fontSize: "0.75rem", color: "rgba(210,180,140,0.55)", borderBottom: "1px solid rgba(139,105,20,0.12)" }}>
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
                        borderBottom: "1px solid rgba(139,105,20,0.08)",
                        background: w.daysRemaining <= 3 ? "rgba(139,20,20,0.08)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "0.5rem 0", fontFamily: "monospace", fontSize: "0.75rem", color: "#F5EBD4" }}>{w.animalId ?? "—"}</td>
                      <td style={{ padding: "0.5rem 0", color: "rgba(210,180,140,0.75)" }}>{w.campId}</td>
                      <td style={{ padding: "0.5rem 0", color: "#F5EBD4", fontWeight: 500 }}>{w.drug}</td>
                      <td style={{ padding: "0.5rem 0", color: "rgba(210,180,140,0.55)", fontSize: "0.75rem" }}>{w.observedAt}</td>
                      <td style={{
                        padding: "0.5rem 0",
                        textAlign: "right",
                        fontWeight: 600,
                        color: w.daysRemaining <= 3 ? "#C0574C" : "#F5EBD4",
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
