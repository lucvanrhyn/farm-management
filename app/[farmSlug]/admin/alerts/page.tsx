export const dynamic = "force-dynamic";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { getDashboardAlerts } from "@/lib/server/dashboard-alerts";
import AlertsFilterClient from "@/components/admin/AlertsFilterClient";
import UpgradePrompt from "@/components/admin/UpgradePrompt";


export default async function AlertsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Alerts & Notifications" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const settings = await prisma.farmSettings.findFirst();

  const thresholds = {
    adgPoorDoerThreshold: settings?.adgPoorDoerThreshold ?? 0.7,
    calvingAlertDays: settings?.calvingAlertDays ?? 14,
    daysOpenLimit: settings?.daysOpenLimit ?? 365,
    campGrazingWarningDays: settings?.campGrazingWarningDays ?? 7,
    staleCampInspectionHours: settings?.alertThresholdHours ?? 48,
  };

  const dashboardAlerts = await getDashboardAlerts(prisma, farmSlug, thresholds);

  // Flatten red + amber into a single array (AlertsFilterClient handles sorting)
  const allAlerts = [...dashboardAlerts.red, ...dashboardAlerts.amber];

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-[#1C1815]">Alerts</h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          All alerts across cattle, sheep, game &amp; farm
        </p>
      </div>

      <AlertsFilterClient alerts={allAlerts} />
    </div>
  );
}
