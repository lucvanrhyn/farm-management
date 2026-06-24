'use client';

import type { DroughtPayload } from '@/lib/server/drought';
import { DroughtSummaryCards } from './DroughtSummaryCards';
import { DroughtSeverityLegend } from './DroughtSeverityLegend';
import { RainfallVsNormalChart } from './RainfallVsNormalChart';
import { SpiTrendChart } from './SpiTrendChart';

interface Props {
  payload:   DroughtPayload;
  farmSlug:  string;
}

export function DroughtClient({ payload, farmSlug }: Props) {
  // Empty state: no lat/lng configured on this farm
  if (!payload.hasCoords) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--ft-border)] bg-[var(--ft-surface)] p-8 text-center">
        <p className="text-sm text-[var(--ft-muted)]">
          Farm location is required to compute drought indices.
        </p>
        <a
          href={`/${farmSlug}/admin/settings`}
          className="mt-3 inline-block rounded-md bg-[var(--ft-good)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ft-good)]"
        >
          Set farm location in Settings →
        </a>
      </div>
    );
  }

  const hasData = payload.monthly.length > 0;

  return (
    <div className="space-y-6">
      <DroughtSummaryCards
        spi3={payload.spi3}
        spi12={payload.spi12}
        ytdMm={payload.ytdMm}
        ytdNormalMm={payload.ytdNormalMm}
        ytdPctOfNormal={payload.ytdPctOfNormal}
      />

      {hasData ? (
        <>
          <RainfallVsNormalChart monthly={payload.monthly} />
          <SpiTrendChart monthly={payload.monthly} />
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--ft-border)] bg-[var(--ft-surface)] p-6 text-center text-sm text-[var(--ft-subtle)]">
          No rainfall data available yet. Record rainfall observations in the Logger to build your drought history.
        </div>
      )}

      <DroughtSeverityLegend />

      {payload.lastFarmObserved && (
        <p className="text-xs text-[var(--ft-subtle)]">
          Last farm-recorded rainfall: {payload.lastFarmObserved}. Months without farm records use ERA5 archive data.
        </p>
      )}
    </div>
  );
}
