import { notFound } from 'next/navigation';
import { getFarmCreds } from '@/lib/meta-db';
import { getPrismaForFarm } from '@/lib/farm-prisma';
import { getFarmSummary } from '@/lib/server/veld-score';
import UpgradePrompt from '@/components/admin/UpgradePrompt';
import { VeldAssessmentForm } from '@/components/veld/VeldAssessmentForm';
import { VeldCampSummaryCards } from '@/components/veld/VeldCampSummaryCards';
import { VeldHistoryTable } from '@/components/veld/VeldHistoryTable';
import { VeldTrendChart } from '@/components/veld/VeldTrendChart';
import type { BiomeType } from '@/lib/calculators/veld-score';

export const dynamic = 'force-dynamic';

export default async function VeldToolPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const creds = await getFarmCreds(farmSlug);
  if (!creds) notFound();
  if (creds.tier === 'basic') {
    return <UpgradePrompt feature="Veld Condition Scoring" farmSlug={farmSlug} />;
  }
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) notFound();

  const [summary, camps, settings, recent] = await Promise.all([
    getFarmSummary(prisma),
    prisma.camp.findMany({ select: { campId: true, campName: true, sizeHectares: true } }),
    prisma.farmSettings.findUnique({
      where: { id: 'singleton' },
      select: { biomeType: true },
    }),
    prisma.veldAssessment.findMany({
      orderBy: { assessmentDate: 'desc' },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold text-emerald-900">Veld Condition Scoring</h1>
        <p className="text-sm text-gray-600">
          DFFE-aligned rangeland assessment. Biome:{' '}
          <strong>{settings?.biomeType ?? 'not set'}</strong>.{' '}
          {!settings?.biomeType && (
            <a href={`/${farmSlug}/admin/settings`} className="underline">
              Set biome in Settings
            </a>
          )}
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Kpi label="Avg score" value={summary.averageScore?.toFixed(1) ?? '—'} tone="neutral" />
        <Kpi
          label="Camps assessed"
          value={`${summary.campsAssessed}/${summary.campsTotal}`}
          tone="neutral"
        />
        <Kpi label="Critical" value={String(summary.critical.length)} tone="red" />
        <Kpi label="Declining" value={String(summary.declining.length)} tone="amber" />
      </section>

      <VeldAssessmentForm
        farmSlug={farmSlug}
        camps={camps}
        biome={(settings?.biomeType ?? 'mixedveld') as BiomeType}
      />

      <VeldCampSummaryCards summary={summary} />

      <VeldTrendChart summary={summary} />

      <VeldHistoryTable farmSlug={farmSlug} initial={recent} />
    </div>
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
