import { notFound } from 'next/navigation';
import { getFarmCreds } from '@/lib/meta-db';
import { getPrismaForFarm } from '@/lib/farm-prisma';
import { getDroughtPayload } from '@/lib/server/drought';
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
    return <UpgradePrompt feature="Drought Tracking" />;
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
      <header>
        <h1 className="text-2xl font-semibold text-emerald-900">Drought Tracking</h1>
        <p className="text-sm text-gray-600">
          Standard Precipitation Index (SPI) based on 30-year ERA5 climatology.
          Negative SPI = drier than normal; below −1 = meteorological drought.
        </p>
      </header>

      <DroughtClient payload={droughtPayload} farmSlug={farmSlug} />
    </div>
  );
}
