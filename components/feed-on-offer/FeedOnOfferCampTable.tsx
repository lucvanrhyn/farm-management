'use client';

import type { CampFeedOnOfferSummary } from '@/lib/server/feed-on-offer';

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-[var(--ft-crit-bg)] text-[var(--ft-crit)]', text: 'text-[var(--ft-crit)]', label: 'Critical' },
  low:      { bg: 'bg-[var(--ft-fair-bg)] text-[var(--ft-fair)]', text: 'text-[var(--ft-fair)]', label: 'Low' },
  adequate: { bg: 'bg-[var(--ft-good-bg)] text-[var(--ft-good)]', text: 'text-[var(--ft-good)]', label: 'Adequate' },
  good:     { bg: 'bg-[var(--ft-good-bg)] text-[var(--ft-good)]', text: 'text-[var(--ft-good)]', label: 'Good' },
  unknown:  { bg: 'bg-[var(--ft-surface)] text-[var(--ft-subtle)]', text: 'text-[var(--ft-subtle)]', label: 'No data' },
};

export function FeedOnOfferCampTable({ byCamp }: { byCamp: readonly CampFeedOnOfferSummary[] }) {
  if (byCamp.length === 0) {
    return <p className="text-sm text-[var(--ft-subtle)]">No camps found.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-[var(--ft-surface)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--ft-surface)] text-left text-xs uppercase text-[var(--ft-subtle)]">
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
            const badge = STATUS_BADGE[c.feedOnOffer.status] ?? STATUS_BADGE.unknown;
            return (
              <tr key={c.campId}>
                <td className="px-4 py-2 font-medium">{c.campName}</td>
                <td className="px-4 py-2">
                  {c.feedOnOffer.kgDmPerHa != null ? Math.round(c.feedOnOffer.kgDmPerHa) : '—'}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.bg}`}>
                    {badge.label}
                  </span>
                </td>
                <td className="px-4 py-2 hidden md:table-cell">
                  {c.feedOnOffer.effectiveFeedOnOfferKg != null
                    ? Math.round(c.feedOnOffer.effectiveFeedOnOfferKg).toLocaleString()
                    : '—'}
                </td>
                <td className="px-4 py-2 hidden md:table-cell">
                  {c.feedOnOffer.capacityLsuDays != null
                    ? Math.round(c.feedOnOffer.capacityLsuDays).toLocaleString()
                    : '—'}
                </td>
                <td className="px-4 py-2">
                  {c.latestReading ? (
                    <span className={c.feedOnOffer.isStale ? 'text-[var(--ft-fair)]' : 'text-[var(--ft-muted)]'}>
                      {c.latestReading.recordedAt.slice(0, 10)}
                      {c.feedOnOffer.isStale && ' (stale)'}
                    </span>
                  ) : (
                    <span className="text-[var(--ft-subtle)]">never</span>
                  )}
                </td>
                <td className="px-4 py-2 hidden md:table-cell">
                  {c.trendSlope !== 0 && c.readingCount >= 2 ? (
                    <span className={c.trendSlope < 0 ? 'text-[var(--ft-crit)]' : 'text-[var(--ft-good)]'}>
                      {c.trendSlope > 0 ? '▲' : '▼'}{' '}
                      {Math.abs(c.trendSlope).toFixed(0)} kg/mo
                    </span>
                  ) : (
                    <span className="text-[var(--ft-subtle)]">—</span>
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
