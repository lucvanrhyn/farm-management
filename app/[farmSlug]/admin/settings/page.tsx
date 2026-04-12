import { getPrismaForFarm } from "@/lib/farm-prisma";
import SettingsForm, { type FarmSettingsData } from "@/components/admin/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
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
    physicalAddress: raw?.physicalAddress ?? "",
    postalAddress: raw?.postalAddress ?? "",
    contactPhone: raw?.contactPhone ?? "",
    contactEmail: raw?.contactEmail ?? "",
    propertyRegNumber: raw?.propertyRegNumber ?? "",
    farmRegion: raw?.farmRegion ?? "",
    biomeType: raw?.biomeType ?? null,
  };

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8] min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "#1C1815" }}>
          Farm Settings
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          Thresholds, location, breeding calendar, and integrations
        </p>
      </div>

      <div className="max-w-2xl">
        <SettingsForm farmSlug={farmSlug} initial={settings} />
      </div>
    </div>
  );
}
