'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Assessment {
  id: string;
  campId: string;
  assessmentDate: string;
  assessor: string;
  veldScore: number;
  haPerLsu: number | null;
  notes: string | null;
}

export function VeldHistoryTable({
  farmSlug,
  initial,
}: {
  farmSlug: string;
  initial: Assessment[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onDelete(id: string) {
    if (!confirm('Delete this assessment? This cannot be undone.')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/${farmSlug}/veld-assessments/${id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (initial.length === 0) {
    return (
      <div className="rounded border bg-white p-4 text-sm text-gray-500">
        No assessments yet. Record your first camp walk above.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="p-2">Date</th>
            <th className="p-2">Camp</th>
            <th className="p-2">Assessor</th>
            <th className="p-2">Score</th>
            <th className="p-2">ha/LSU</th>
            <th className="p-2">Notes</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {initial.map((a) => (
            <tr key={a.id} className="border-t">
              <td className="p-2">{a.assessmentDate}</td>
              <td className="p-2">{a.campId}</td>
              <td className="p-2">{a.assessor}</td>
              <td className="p-2">
                <ScoreChip score={a.veldScore} />
              </td>
              <td className="p-2">{a.haPerLsu ?? '—'}</td>
              <td className="max-w-xs truncate p-2 text-gray-500">{a.notes ?? ''}</td>
              <td className="p-2 text-right">
                <button
                  type="button"
                  onClick={() => onDelete(a.id)}
                  disabled={busyId === a.id}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreChip({ score }: { score: number }) {
  const color =
    score >= 7
      ? 'bg-emerald-100 text-emerald-800'
      : score >= 4
      ? 'bg-amber-100 text-amber-800'
      : 'bg-red-100 text-red-800';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}
