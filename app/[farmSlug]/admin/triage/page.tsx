export const dynamic = "force-dynamic";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { getTriage } from "@/lib/server/triage/get-triage";
import TriageClient from "@/components/admin/TriageClient";
import { PageHeader } from "@/components/ds";
import AdminPage from "@/app/_components/AdminPage";

/**
 * Herd Triage — the per-animal "which animal first?" surface.
 *
 * Deliberately NOT tier-gated: triage is the trial-acquisition aha moment (it
 * works on day-1 import via snapshot reasons), so every tier — including
 * the basic plan — sees it. (The meta-db tier union is two plan strings; there
 * is no separate trial tier string.) Mirrors the alerts page scaffold but
 * intentionally omits the basic-plan upgrade-gate branch the alerts page uses.
 *
 * `mode` threads the active-species switcher into getTriage so the list tracks
 * the dashboard (cattle/sheep). getTriage is NEVER cattle-hard-scoped.
 */
export default async function TriagePage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

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

  const mode = await getFarmMode(farmSlug);

  const settings = await prisma.farmSettings.findFirst();

  const thresholds = {
    adgPoorDoerThreshold: settings?.adgPoorDoerThreshold ?? 0.7,
    calvingAlertDays: settings?.calvingAlertDays ?? 14,
    daysOpenLimit: settings?.daysOpenLimit ?? 365,
    campGrazingWarningDays: settings?.campGrazingWarningDays ?? 7,
    staleCampInspectionHours: settings?.alertThresholdHours ?? 48,
  };

  const items = await getTriage(prisma, farmSlug, thresholds, mode);

  return (
    <AdminPage>
      <PageHeader
        className="px-0 py-0 mb-5"
        title="Triage"
        subtitle="which animal needs you first · cattle & sheep"
      />

      <TriageClient items={items} farmSlug={farmSlug} />
    </AdminPage>
  );
}
