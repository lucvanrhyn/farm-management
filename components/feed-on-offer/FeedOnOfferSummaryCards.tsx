import type { FarmFeedOnOfferSummary } from '@/lib/calculators/feed-on-offer';

export function FeedOnOfferSummaryCards({ summary }: { summary: FarmFeedOnOfferSummary }) {
  const totalTonnes = (summary.totalPastureInventoryKg / 1000).toFixed(1);

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <Kpi
        label="Pasture inventory"
        value={`${totalTonnes} t`}
        tone="neutral"
      />
      <Kpi
        label="Avg Feed on Offer"
        value={
          summary.averageFeedOnOfferKgDmPerHa != null
            ? `${Math.round(summary.averageFeedOnOfferKgDmPerHa)} kg/ha`
            : '—'
        }
        tone="neutral"
      />
      <Kpi
        label="Critical camps"
        value={String(summary.campsCritical)}
        tone={summary.campsCritical > 0 ? 'red' : 'neutral'}
      />
      <Kpi
        label="Stale readings"
        value={String(summary.campsStaleReading)}
        tone={summary.campsStaleReading > 0 ? 'amber' : 'neutral'}
      />
    </section>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'red' | 'amber' | 'neutral';
}) {
  const bg =
    tone === 'red'
      ? 'bg-[var(--ft-crit-bg)] border-[var(--ft-crit)]'
      : tone === 'amber'
      ? 'bg-[var(--ft-fair-bg)] border-[var(--ft-fair)]'
      : 'bg-[var(--ft-surface)]';
  return (
    <div className={`rounded-lg border p-4 ${bg}`}>
      <div className="text-xs uppercase tracking-wide text-[var(--ft-subtle)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
