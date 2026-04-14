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
      ? 'bg-red-50 border-red-200'
      : tone === 'amber'
      ? 'bg-amber-50 border-amber-200'
      : 'bg-white';
  return (
    <div className={`rounded-lg border p-4 ${bg}`}>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
