'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { calcVeldScore, calcGrazingCapacity, type BiomeType } from '@/lib/calculators/veld-score';

interface Camp {
  campId: string;
  campName: string;
  sizeHectares: number | null;
}

export function VeldAssessmentForm({
  farmSlug,
  camps,
  biome,
}: {
  farmSlug: string;
  camps: Camp[];
  biome: BiomeType;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [campId, setCampId] = useState(camps[0]?.campId ?? '');
  const [assessmentDate, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [assessor, setAssessor] = useState('');
  const [palatablePct, setPalatable] = useState(60);
  const [barePct, setBare] = useState(10);
  const [erosion, setErosion] = useState<0 | 1 | 2>(0);
  const [bush, setBush] = useState<0 | 1 | 2>(0);
  const [notes, setNotes] = useState('');

  const liveScore = calcVeldScore({
    palatableSpeciesPct: palatablePct,
    bareGroundPct: barePct,
    erosionLevel: erosion,
    bushEncroachmentLevel: bush,
  });
  const liveCapacity = calcGrazingCapacity(biome, liveScore);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/${farmSlug}/veld-assessments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campId,
        assessmentDate,
        assessor,
        palatableSpeciesPct: palatablePct,
        bareGroundPct: barePct,
        erosionLevel: erosion,
        bushEncroachmentLevel: bush,
        notes: notes || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Request failed' }));
      setError((body as { error?: string }).error ?? 'Request failed');
      return;
    }
    setAssessor('');
    setNotes('');
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">New assessment</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col text-sm">
          <span className="text-gray-600">Camp</span>
          <select value={campId} onChange={(e) => setCampId(e.target.value)} className="rounded border p-2">
            {camps.map((c) => (
              <option key={c.campId} value={c.campId}>
                {c.campName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-gray-600">Date</span>
          <input
            type="date"
            value={assessmentDate}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border p-2"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-gray-600">Assessor</span>
          <input
            type="text"
            value={assessor}
            onChange={(e) => setAssessor(e.target.value)}
            required
            maxLength={100}
            className="rounded border p-2"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Slider
          label="Palatable species %"
          value={palatablePct}
          onChange={setPalatable}
          hint="How much of the sward is made up of desirable grass species?"
        />
        <Slider
          label="Bare ground %"
          value={barePct}
          onChange={setBare}
          hint="What percentage of ground is bare (no basal cover)?"
        />
        <LevelPicker
          label="Erosion"
          value={erosion}
          onChange={(v) => setErosion(v as 0 | 1 | 2)}
          labels={['None', 'Moderate', 'Severe']}
        />
        <LevelPicker
          label="Bush encroachment"
          value={bush}
          onChange={(v) => setBush(v as 0 | 1 | 2)}
          labels={['Sparse', 'Moderate', 'Dense']}
        />
      </div>

      <label className="flex flex-col text-sm">
        <span className="text-gray-600">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          className="rounded border p-2"
        />
      </label>

      <div className="flex flex-wrap items-center gap-4 rounded bg-emerald-50 p-3 text-sm">
        <div>
          <div className="text-xs uppercase text-emerald-700">Live score</div>
          <div className="text-2xl font-semibold text-emerald-900">{liveScore.toFixed(1)} / 10</div>
        </div>
        <div>
          <div className="text-xs uppercase text-emerald-700">Grazing capacity</div>
          <div className="text-lg text-emerald-900">
            {liveCapacity.haPerLsu ? `${liveCapacity.haPerLsu} ha/LSU` : '—'}
          </div>
        </div>
      </div>

      {error && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}

      <button
        type="submit"
        disabled={isPending || !assessor}
        className="rounded bg-emerald-700 px-4 py-2 text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {isPending ? 'Saving…' : 'Save assessment'}
      </button>
    </form>
  );
}

function Slider({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint: string;
}) {
  return (
    <label className="flex flex-col text-sm">
      <span className="text-gray-600">
        {label} — <strong>{value}%</strong>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="text-xs text-gray-400">{hint}</span>
    </label>
  );
}

function LevelPicker({
  label,
  value,
  onChange,
  labels,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  labels: [string, string, string];
}) {
  return (
    <div className="flex flex-col text-sm">
      <span className="text-gray-600">{label}</span>
      <div className="mt-1 flex gap-1">
        {labels.map((lab, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onChange(idx)}
            className={`flex-1 rounded border p-2 text-xs ${
              value === idx ? 'bg-emerald-700 text-white' : 'bg-white'
            }`}
          >
            {lab}
          </button>
        ))}
      </div>
    </div>
  );
}
