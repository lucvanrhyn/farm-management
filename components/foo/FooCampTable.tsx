'use client';

import type { CampFooSummary } from '@/lib/server/foo';

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-100 text-red-700', text: 'text-red-600', label: 'Critical' },
  low:      { bg: 'bg-amber-100 text-amber-700', text: 'text-amber-600', label: 'Low' },
  adequate: { bg: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-600', label: 'Adequate' },
  good:     { bg: 'bg-green-100 text-green-700', text: 'text-green-600', label: 'Good' },
  unknown:  { bg: 'bg-gray-100 text-gray-500', text: 'text-gray-400', label: 'No data' },
};

export function FooCampTable({ byCamp }: { byCamp: readonly CampFooSummary[] }) {
  if (byCamp.length === 0) {
    return <p className="text-sm text-gray-500">No camps found.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">Camp</th>
            <th className="px-4 py-2">kg DM/ha</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2 hidden md:table-cell">Effective (kg)</th>
            <th className="px-4 py-2 hidden md:table-cell">Capacity (LSU-days)</th>
            <th className="px-4 py-2">Last reading</th>
            <th className="px-4 py-2 hidden md:table-cell">Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {byCamp.map((c) => {
            const badge = STATUS_BADGE[c.foo.status] ?? STATUS_BADGE.unknown;
            return (
              <tr key={c.campId}>
                <td className="px-4 py-2 font-medium">{c.campName}</td>
                <td className="px-4 py-2">
                  {c.foo.kgDmPerHa != null ? Math.round(c.foo.kgDmPerHa) : '—'}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.bg}`}>
                    {badge.label}
                  </span>
                </td>
                <td className="px-4 py-2 hidden md:table-cell">
                  {c.foo.effectiveFooKg != null
                    ? Math.round(c.foo.effectiveFooKg).toLocaleString()
                    : '—'}
                </td>
                <td className="px-4 py-2 hidden md:table-cell">
                  {c.foo.capacityLsuDays != null
                    ? Math.round(c.foo.capacityLsuDays).toLocaleString()
                    : '—'}
                </td>
                <td className="px-4 py-2">
                  {c.latestReading ? (
                    <span className={c.foo.isStale ? 'text-amber-600' : 'text-gray-600'}>
                      {c.latestReading.recordedAt.slice(0, 10)}
                      {c.foo.isStale && ' (stale)'}
                    </span>
                  ) : (
                    <span className="text-gray-400">never</span>
                  )}
                </td>
                <td className="px-4 py-2 hidden md:table-cell">
                  {c.trendSlope !== 0 && c.readingCount >= 2 ? (
                    <span className={c.trendSlope < 0 ? 'text-red-600' : 'text-emerald-600'}>
                      {c.trendSlope > 0 ? '▲' : '▼'}{' '}
                      {Math.abs(c.trendSlope).toFixed(0)} kg/mo
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
