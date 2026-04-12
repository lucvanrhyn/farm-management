import Link from 'next/link';
import type { FarmVeldSummary } from '@/lib/server/veld-score';
import { VeldCampSummaryCards } from '@/components/veld/VeldCampSummaryCards';

export function VeldTab({ farmSlug, summary }: { farmSlug: string; summary: FarmVeldSummary }) {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold">Veld condition</h2>
          <p className="text-sm text-gray-600">
            Latest score per camp. Record new assessments in{' '}
            <Link href={`/${farmSlug}/tools/veld`} className="underline">
              Tools → Veld
            </Link>
            .
          </p>
        </div>
      </div>
      <VeldCampSummaryCards summary={summary} />
    </div>
  );
}
