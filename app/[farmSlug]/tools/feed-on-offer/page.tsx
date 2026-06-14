import { notFound } from 'next/navigation';
import { getFarmCreds } from '@/lib/meta-db';
import { getPrismaForFarm } from '@/lib/farm-prisma';
import { getFarmMode } from '@/lib/server/get-farm-mode';
import { scoped } from '@/lib/server/species-scoped-prisma';
import { getFarmFeedOnOfferPayload } from '@/lib/server/feed-on-offer';
import { PageHeader } from '@/components/ds';
import UpgradePrompt from '@/components/admin/UpgradePrompt';
import { FeedOnOfferSummaryCards } from '@/components/feed-on-offer/FeedOnOfferSummaryCards';
import { FeedOnOfferCampTable } from '@/components/feed-on-offer/FeedOnOfferCampTable';
import { CoverReadingForm } from '@/components/feed-on-offer/CoverReadingForm';
import nextDynamic from 'next/dynamic';

const FeedOnOfferTrendChart = nextDynamic(
  () => import('@/components/feed-on-offer/FeedOnOfferTrendChart').then((m) => ({ default: m.FeedOnOfferTrendChart })),
  { loading: () => <div className="h-48 animate-pulse bg-[var(--ft-surface)] rounded-lg" /> },
);

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
    return <UpgradePrompt feature="Feed on Offer" farmSlug={farmSlug} />;
  }
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) notFound();

  const mode = await getFarmMode(farmSlug);

  const [payload, camps] = await Promise.all([
    getFarmFeedOnOfferPayload(prisma),
    scoped(prisma, mode).camp.findMany({
      select: { campId: true, campName: true, sizeHectares: true },
      orderBy: { campName: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6 p-4">
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Feed on Offer"
        subtitle="feed on offer"
      />

      <FeedOnOfferSummaryCards summary={payload.summary} />

      <CoverReadingForm farmSlug={farmSlug} camps={camps} />

      <FeedOnOfferCampTable byCamp={payload.byCamp} />

      <FeedOnOfferTrendChart trendData={payload.trendData} />
    </div>
  );
}
