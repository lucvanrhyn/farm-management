import type { FarmVeldSummary } from '@/lib/server/veld-score';

export function VeldCampSummaryCards({ summary }: { summary: FarmVeldSummary }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {summary.byCamp.map((c) => (
        <div key={c.campId} className="rounded border bg-white p-3 shadow-sm">
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">{c.campId}</div>
            <div className="text-sm text-gray-500">{c.latestDate ?? 'never'}</div>
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {c.latestScore != null ? c.latestScore.toFixed(1) : '—'}
          </div>
          <div className="text-xs text-gray-500">
            {c.haPerLsu ? `${c.haPerLsu} ha/LSU` : '—'}{' '}
            {c.trendSlope !== 0 && (
              <span className={c.trendSlope < 0 ? 'text-red-600' : 'text-emerald-600'}>
                {c.trendSlope > 0 ? '▲' : '▼'} {Math.abs(c.trendSlope).toFixed(2)}/mo
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
