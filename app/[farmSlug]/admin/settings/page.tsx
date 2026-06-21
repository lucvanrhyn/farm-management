export const dynamic = "force-dynamic";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { PageHeader } from "@/components/ds";
import SettingsForm, { type FarmSettingsData } from "@/components/admin/SettingsForm";


export default async function SettingsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[var(--ft-bg)] items-center justify-center">
        <p className="text-[var(--ft-crit)]">Farm not found.</p>
      </div>
    );
  }

  const raw = await prisma.farmSettings.findFirst();

  const settings: FarmSettingsData = {
    farmName: raw?.farmName ?? "My Farm",
    breed: raw?.breed ?? "Mixed",
    alertThresholdHours: raw?.alertThresholdHours ?? 48,
    adgPoorDoerThreshold: raw?.adgPoorDoerThreshold ?? 0.7,
    calvingAlertDays: raw?.calvingAlertDays ?? 14,
    daysOpenLimit: raw?.daysOpenLimit ?? 365,
    repeatedTreatmentCount: raw?.repeatedTreatmentCount ?? 3,
    repeatedTreatmentWindowDays: raw?.repeatedTreatmentWindowDays ?? 90,
    campGrazingWarningDays: raw?.campGrazingWarningDays ?? 7,
    targetStockingRate: raw?.targetStockingRate ?? null,
    latitude: raw?.latitude ?? null,
    longitude: raw?.longitude ?? null,
    breedingSeasonStart: raw?.breedingSeasonStart ?? "",
    breedingSeasonEnd: raw?.breedingSeasonEnd ?? "",
    weaningDate: raw?.weaningDate ?? "",
    defaultRestDays: raw?.defaultRestDays ?? 60,
    defaultMaxGrazingDays: raw?.defaultMaxGrazingDays ?? 7,
    rotationSeasonMode: (raw?.rotationSeasonMode as "auto" | "growing" | "dormant" | undefined) ?? "auto",
    dormantSeasonMultiplier: raw?.dormantSeasonMultiplier ?? 1.4,
    openaiApiKeyConfigured: !!(raw?.openaiApiKey),
    ownerName: raw?.ownerName ?? "",
    ownerIdNumber: raw?.ownerIdNumber ?? "",
    taxReferenceNumber: raw?.taxReferenceNumber ?? "",
    physicalAddress: raw?.physicalAddress ?? "",
    postalAddress: raw?.postalAddress ?? "",
    contactPhone: raw?.contactPhone ?? "",
    contactEmail: raw?.contactEmail ?? "",
    propertyRegNumber: raw?.propertyRegNumber ?? "",
    aiaIdentificationMark: raw?.aiaIdentificationMark ?? "",
    farmRegion: raw?.farmRegion ?? "",
    biomeType: raw?.biomeType ?? null,
  };

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)] min-h-screen">
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Farm Settings"
        subtitle="Thresholds, location, breeding calendar, and integrations"
      />

      <div className="max-w-2xl">
        <SettingsForm farmSlug={farmSlug} initial={settings} />
      </div>
    </div>
  );
}
