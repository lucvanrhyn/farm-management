'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { DroughtMonthRow } from '@/lib/server/drought';

interface Props {
  monthly: DroughtMonthRow[];
}

export function RainfallVsNormalChart({ monthly }: Props) {
  if (monthly.length === 0) return null;

  const data = monthly.map((row) => ({
    month: row.month.slice(5), // "MM" portion for compact x-axis labels
    year:  row.month.slice(0, 4),
    label: row.month,
    actual: parseFloat(row.actualMm.toFixed(1)),
    normal: parseFloat(row.normalMm.toFixed(1)),
    dimmed: row.source === 'archive',
  }));

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        Rainfall vs. 30-Year Normal (last 24 months)
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            tickFormatter={(v: string) => v.slice(2).replace('-', '/')}
          />
          <YAxis
            unit=" mm"
            tick={{ fontSize: 10 }}
            width={50}
          />
          <Tooltip
            formatter={(value, name) => [
              `${value} mm`,
              name === 'actual' ? 'Actual rainfall' : '30-yr normal',
            ]}
            labelFormatter={(label) => `Month: ${label}`}
          />
          <Legend
            formatter={(value) =>
              value === 'actual' ? 'Actual rainfall' : '30-yr normal'
            }
          />
          <Bar
            dataKey="normal"
            fill="#d1d5db"
            radius={[2, 2, 0, 0]}
            name="normal"
          />
          <Bar
            dataKey="actual"
            fill="#047857"
            radius={[2, 2, 0, 0]}
            name="actual"
            opacity={0.85}
          />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-gray-400">
        Dimmed months use ERA5 archive data where no farm record exists.
      </p>
    </div>
  );
}
