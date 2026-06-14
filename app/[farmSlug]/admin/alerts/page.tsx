export const dynamic = "force-dynamic";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { getDashboardAlerts } from "@/lib/server/dashboard-alerts";
import AlertsFilterClient from "@/components/admin/AlertsFilterClient";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import { PageHeader } from "@/components/ds";
import AdminPage from "@/app/_components/AdminPage";


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
      <AdminPage>
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[var(--ft-crit)]">Farm not found.</p>
        </div>
      </AdminPage>
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
    <AdminPage>
      <PageHeader
        className="px-0 py-0 mb-5"
        title="Alerts"
        subtitle="alert centre · across cattle, sheep, game & farm"
      />

      <AlertsFilterClient alerts={allAlerts} />
    </AdminPage>
  );
}
