import { notFound } from 'next/navigation';
import { getFarmCreds } from '@/lib/meta-db';
import { getPrismaForFarm } from '@/lib/farm-prisma';
import { getFarmFeedOnOfferPayload } from '@/lib/server/feed-on-offer';
import UpgradePrompt from '@/components/admin/UpgradePrompt';
import { FeedOnOfferSummaryCards } from '@/components/feed-on-offer/FeedOnOfferSummaryCards';
import { FeedOnOfferCampTable } from '@/components/feed-on-offer/FeedOnOfferCampTable';
import { CoverReadingForm } from '@/components/feed-on-offer/CoverReadingForm';
import { FeedOnOfferTrendChart } from '@/components/feed-on-offer/FeedOnOfferTrendChart';

export const dynamic = 'force-dynamic';

export default async function FeedOnOfferToolPage({
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
    getFarmFeedOnOfferPayload(prisma),
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
          Farm pasture inventory and grazing capacity. Record cover readings to track Feed on Offer per camp.
        </p>
      </header>

      <FeedOnOfferSummaryCards summary={payload.summary} />

      <CoverReadingForm farmSlug={farmSlug} camps={camps} />

      <FeedOnOfferCampTable byCamp={payload.byCamp} />

      <FeedOnOfferTrendChart trendData={payload.trendData} />
    </div>
  );
}
