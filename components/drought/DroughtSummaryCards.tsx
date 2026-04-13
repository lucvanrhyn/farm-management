import type { SpiWindow } from '@/lib/server/drought';
import type { SpiSeverity } from '@/lib/calculators/spi';

interface Props {
  spi3:          SpiWindow | null;
  spi12:         SpiWindow | null;
  ytdMm:         number;
  ytdNormalMm:   number;
  ytdPctOfNormal: number;
}

export function DroughtSummaryCards({ spi3, spi12, ytdMm, ytdNormalMm, ytdPctOfNormal }: Props) {
  const pctLabel =
    ytdNormalMm > 0
      ? `${Math.round(ytdPctOfNormal * 100)}% of normal`
      : '—';

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SpiCard
        label="SPI-3 (3-month)"
        window={spi3}
        tooltip="Standard Precipitation Index over the last 3 months. Negative = drier than normal."
      />
      <SpiCard
        label="SPI-12 (12-month)"
        window={spi12}
        tooltip="Standard Precipitation Index over the last 12 months. Captures long-term drought."
      />
      <Kpi
        label="YTD Rainfall"
        value={`${Math.round(ytdMm)} mm`}
        sub={ytdNormalMm > 0 ? `Normal: ${Math.round(ytdNormalMm)} mm` : undefined}
        tone="neutral"
      />
      <Kpi
        label="YTD % of Normal"
        value={pctLabel}
        tone={
          ytdPctOfNormal < 0.6
            ? 'red'
            : ytdPctOfNormal < 0.8
            ? 'amber'
            : 'neutral'
        }
      />
    </section>
  );
}

function spiTone(s: SpiSeverity): 'red' | 'amber' | 'neutral' {
  if (s === 'extreme-drought' || s === 'severe-drought') return 'red';
  if (s === 'moderate-drought' || s === 'mild-dry') return 'amber';
  return 'neutral';
}

function SpiCard({ label, window, tooltip }: { label: string; window: SpiWindow | null; tooltip?: string }) {
  if (!window) {
    return <Kpi label={label} value="—" tone="neutral" />;
  }
  return (
    <Kpi
      label={label}
      value={window.value.toFixed(2)}
      sub={window.severity.replace(/-/g, ' ')}
      tone={spiTone(window.severity)}
      tooltip={tooltip}
    />
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  tooltip,
}: {
  label:    string;
  value:    string;
  sub?:     string;
  tone:     'red' | 'amber' | 'neutral';
  tooltip?: string;
}) {
  const bg =
    tone === 'red'
      ? 'bg-red-50 border-red-200'
      : tone === 'amber'
      ? 'bg-amber-50 border-amber-200'
      : 'bg-white';

  return (
    <div className={`rounded-lg border p-4 ${bg}`} title={tooltip}>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && (
        <div className="mt-0.5 text-xs capitalize text-gray-500">{sub}</div>
      )}
    </div>
  );
}
