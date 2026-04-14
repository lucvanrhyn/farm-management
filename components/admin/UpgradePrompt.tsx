import Link from 'next/link';
import { computeFarmLsu } from '@/lib/pricing/farm-lsu';
import { quoteTier } from '@/lib/pricing/calculator';

interface Props {
  feature: string;
  description?: string;
  farmSlug: string;
}

export default async function UpgradePrompt({ feature, description, farmSlug }: Props) {
  // Compute live quote — graceful fallback if LSU computation fails
  let quote: { annualFormatted: string; monthlyFormatted: string; lsu: number } | null = null;
  try {
    const lsu = await computeFarmLsu(farmSlug);
    const q = quoteTier('advanced', lsu);
    quote = {
      annualFormatted: q.annualFormatted,
      monthlyFormatted: q.monthlyFormatted,
      lsu,
    };
  } catch {
    // Non-critical — show the prompt without the computed price
  }

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
      <h2 className="text-2xl font-semibold text-amber-900">{feature} is on Advanced</h2>

      {description && (
        <p className="mt-2 text-sm text-amber-700">{description}</p>
      )}

      {quote ? (
        <div className="mt-6 rounded-xl bg-white p-5 text-left border border-amber-100">
          <p className="text-sm text-neutral-500">
            Your farm ({quote.lsu} LSU) on Advanced:
          </p>
          <p className="mt-1 text-3xl font-semibold text-neutral-900">
            {quote.annualFormatted}
            <span className="ml-2 text-base font-normal text-neutral-500">/year</span>
          </p>
          <p className="text-sm text-neutral-400">
            or {quote.monthlyFormatted}/month
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-amber-700">
          Upgrade to Advanced to unlock the full intelligence stack.
        </p>
      )}

      <Link
        href={`/${farmSlug}/subscribe/upgrade`}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-emerald-600 px-6 py-3 text-white font-medium hover:bg-emerald-700 transition-colors"
      >
        Upgrade to Advanced
      </Link>
    </div>
  );
}
