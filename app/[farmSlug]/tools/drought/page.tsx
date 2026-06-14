import { notFound } from 'next/navigation';
import { getFarmCreds } from '@/lib/meta-db';
import { getPrismaForFarm } from '@/lib/farm-prisma';
import { getDroughtPayload } from '@/lib/server/drought';
import { PageHeader } from '@/components/ds';
import UpgradePrompt from '@/components/admin/UpgradePrompt';
import { DroughtClient } from '@/components/drought/DroughtClient';

export const dynamic = 'force-dynamic';

export default async function DroughtToolPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const creds = await getFarmCreds(farmSlug);
  if (!creds) notFound();
  if (creds.tier === 'basic') {
    return <UpgradePrompt feature="Drought Tracking" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) notFound();

  const settings = await prisma.farmSettings.findFirst({
    select: { latitude: true, longitude: true },
  });

  const lat = settings?.latitude ?? null;
  const lng = settings?.longitude ?? null;
  const droughtPayload = await getDroughtPayload(prisma, lat, lng);

  return (
    <div className="space-y-6 p-4">
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Drought Tracking"
        subtitle="drought tracking"
      />

      <DroughtClient payload={droughtPayload} farmSlug={farmSlug} />
    </div>
  );
}
