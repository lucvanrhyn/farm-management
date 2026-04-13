'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { DroughtMonthRow } from '@/lib/server/drought';

interface Props {
  monthly: DroughtMonthRow[];
}

export function SpiTrendChart({ monthly }: Props) {
  if (monthly.length < 3) return null;

  const data = monthly.map((row) => ({
    label: row.month.slice(2).replace('-', '/'), // "YY/MM"
    spi:   parseFloat(row.spi.toFixed(2)),
    severity: row.severity,
  }));

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        SPI-1 Trend (last 24 months)
      </h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
          <YAxis
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => v.toFixed(1)}
            tick={{ fontSize: 10 }}
          />
          <Tooltip
            formatter={(value) => [typeof value === 'number' ? value.toFixed(2) : value, 'SPI-1']}
            labelFormatter={(label) => `Month: 20${label}`}
          />
          {/* WMO reference lines */}
          <ReferenceLine y={0}    stroke="#6b7280" strokeDasharray="4 2" />
          <ReferenceLine y={-1}   stroke="#f59e0b" strokeDasharray="4 2"
            label={{ value: 'Moderate drought', fill: '#f59e0b', fontSize: 10, position: 'right' }} />
          <ReferenceLine y={-1.5} stroke="#ef4444" strokeDasharray="4 2"
            label={{ value: 'Severe drought',   fill: '#ef4444', fontSize: 10, position: 'right' }} />
          <ReferenceLine y={-2}   stroke="#7f1d1d" strokeDasharray="4 2"
            label={{ value: 'Extreme drought',  fill: '#7f1d1d', fontSize: 10, position: 'right' }} />
          <Line
            type="monotone"
            dataKey="spi"
            stroke="#047857"
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-gray-400">
        SPI-1 = single-month anomaly. Below −1 = meteorological drought begins.
      </p>
    </div>
  );
}
