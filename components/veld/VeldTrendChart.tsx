'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { FarmVeldSummary } from '@/lib/server/veld-score';

export function VeldTrendChart({ summary }: { summary: FarmVeldSummary }) {
  if (summary.campsAssessed === 0) return null;

  const byMonth = new Map<string, number[]>();
  for (const c of summary.byCamp) {
    if (c.latestDate && c.latestScore != null) {
      const month = c.latestDate.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month)!.push(c.latestScore);
    }
  }
  const entries = [...byMonth.entries()]
    .sort()
    .map(([month, scores]) => ({
      month,
      avg: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
      camps: scores.length,
    }));

  if (entries.length < 2) return null;

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700">Farm-wide veld trend</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={entries}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis domain={[0, 10]} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="avg" stroke="#047857" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
