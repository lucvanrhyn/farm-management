'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { FOO_CRITICAL_KG_DM, FOO_LOW_KG_DM } from '@/lib/calculators/foo';

interface TrendPoint {
  date: string;
  avgKgDmPerHa: number;
}

export function FooTrendChart({ trendData }: { trendData: readonly TrendPoint[] }) {
  if (trendData.length < 2) return null;

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700">Farm-wide FOO trend</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={[...trendData]}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip
            formatter={(value) => [`${value} kg DM/ha`, 'Avg FOO']}
          />
          <ReferenceLine
            y={FOO_CRITICAL_KG_DM}
            stroke="#ef4444"
            strokeDasharray="4 4"
            label={{ value: 'Critical', fill: '#ef4444', fontSize: 11 }}
          />
          <ReferenceLine
            y={FOO_LOW_KG_DM}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            label={{ value: 'Low', fill: '#f59e0b', fontSize: 11 }}
          />
          <Line
            type="monotone"
            dataKey="avgKgDmPerHa"
            stroke="#047857"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
