'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { classifyFeedOnOfferStatus, DAILY_DMI_PER_LSU } from '@/lib/calculators/feed-on-offer';

const CATEGORY_KG_DM: Record<string, number> = {
  Good: 2000,
  Fair: 1100,
  Poor: 450,
};

interface Camp {
  campId: string;
  campName: string;
  sizeHectares: number | null;
}

export function CoverReadingForm({
  farmSlug,
  camps,
}: {
  farmSlug: string;
  camps: Camp[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [campId, setCampId] = useState(camps[0]?.campId ?? '');
  const [category, setCategory] = useState<'Good' | 'Fair' | 'Poor'>('Fair');
  const [kgOverride, setKgOverride] = useState<string>('');
  const [useOverride, setUseOverride] = useState(false);

  const effectiveKg = useOverride && kgOverride
    ? Number(kgOverride)
    : CATEGORY_KG_DM[category];
  const status = classifyFeedOnOfferStatus(effectiveKg);
  const selectedCamp = camps.find((c) => c.campId === campId);
  const effectiveInventory =
    selectedCamp?.sizeHectares && effectiveKg > 0
      ? effectiveKg * 0.35 * selectedCamp.sizeHectares
      : null;
  const daysGrazing = effectiveInventory ? Math.round(effectiveInventory / DAILY_DMI_PER_LSU) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { coverCategory: category };
    if (useOverride && kgOverride) {
      body.kgDmPerHaOverride = Number(kgOverride);
    }
    const res = await fetch(`/api/${farmSlug}/camps/${campId}/cover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Failed to save reading');
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border bg-white p-4 space-y-4"
    >
      <h3 className="text-sm font-semibold text-gray-700">Record cover reading</h3>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {/* Camp */}
        <div>
          <label className="text-xs text-gray-500">Camp</label>
          <select
            value={campId}
            onChange={(e) => setCampId(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
          >
            {camps.map((c) => (
              <option key={c.campId} value={c.campId}>
                {c.campName}
              </option>
            ))}
          </select>
        </div>

        {/* Cover category */}
        <div>
          <label className="text-xs text-gray-500">Cover category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as 'Good' | 'Fair' | 'Poor')}
            className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
          >
            <option value="Good">Good (2,000 kg/ha)</option>
            <option value="Fair">Fair (1,100 kg/ha)</option>
            <option value="Poor">Poor (450 kg/ha)</option>
          </select>
        </div>

        {/* Override */}
        <div>
          <label className="text-xs text-gray-500 flex items-center gap-1">
            <input
              type="checkbox"
              checked={useOverride}
              onChange={(e) => setUseOverride(e.target.checked)}
            />
            Custom kg DM/ha
          </label>
          {useOverride && (
            <input
              type="number"
              min={0}
              step={10}
              value={kgOverride}
              onChange={(e) => setKgOverride(e.target.value)}
              placeholder="e.g. 1500"
              className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
            />
          )}
        </div>

        {/* Live preview */}
        <div className="flex flex-col justify-end text-sm">
          <div>
            Feed on Offer: <strong>{effectiveKg} kg/ha</strong>{' '}
            <span className={`text-xs ${status === 'critical' ? 'text-red-600' : status === 'low' ? 'text-amber-600' : status === 'good' ? 'text-green-600' : 'text-emerald-600'}`}>
              ({status})
            </span>
          </div>
          {daysGrazing != null && (
            <div className="text-xs text-gray-500">
              ~{daysGrazing.toLocaleString()} LSU-days capacity
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {isPending ? 'Saving…' : 'Save reading'}
      </button>
    </form>
  );
}
