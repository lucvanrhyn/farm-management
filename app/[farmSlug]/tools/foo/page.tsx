import { notFound } from 'next/navigation';
import { getFarmCreds } from '@/lib/meta-db';
import { getPrismaForFarm } from '@/lib/farm-prisma';
import { getFarmFooPayload } from '@/lib/server/foo';
import UpgradePrompt from '@/components/admin/UpgradePrompt';
import { FooSummaryCards } from '@/components/foo/FooSummaryCards';
import { FooCampTable } from '@/components/foo/FooCampTable';
import { CoverReadingForm } from '@/components/foo/CoverReadingForm';
import { FooTrendChart } from '@/components/foo/FooTrendChart';

export const dynamic = 'force-dynamic';

export default async function FooToolPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const creds = await getFarmCreds(farmSlug);
  if (!creds) notFound();
  if (creds.tier === 'basic') {
    return <UpgradePrompt feature="Feed on Offer" />;
  }
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) notFound();

  const [payload, camps] = await Promise.all([
    getFarmFooPayload(prisma),
    prisma.camp.findMany({
      select: { campId: true, campName: true, sizeHectares: true },
      orderBy: { campName: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold text-emerald-900">Feed on Offer</h1>
        <p className="text-sm text-gray-600">
          Farm pasture inventory and grazing capacity. Record cover readings to track FOO per camp.
        </p>
      </header>

      <FooSummaryCards summary={payload.summary} />

      <CoverReadingForm farmSlug={farmSlug} camps={camps} />

      <FooCampTable byCamp={payload.byCamp} />

      <FooTrendChart trendData={payload.trendData} />
    </div>
  );
}
