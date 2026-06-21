export const dynamic = "force-dynamic";
import { Suspense } from "react";
import { requireSession } from "@/lib/auth";
import { getFarmCreds } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { getTriage } from "@/lib/server/triage/get-triage";
import { reasonLabel } from "@/lib/server/triage/labels";
import { narrateTriageItem } from "@/lib/server/triage/narrate";
import type { ReasonId } from "@/lib/server/triage/reasons";
import { getAnimalProfitabilityView } from "@/lib/domain/transactions/animal-profitability-view";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import AdminPage from "@/app/_components/AdminPage";
import { PageHeader } from "@/components/ds";
import ProfitPerCampSection from "@/components/admin/ProfitPerCampSection";
import ProfitabilityClient, {
  type UnderperformerRow,
} from "@/components/admin/profitability/ProfitabilityClient";

/**
 * /admin/profitability — the dedicated, discoverable home for the
 * "which animals/groups make money" lens (CONTEXT.md "Profitability section").
 *
 * Gated EXACTLY like finance (`creds?.tier === "basic"` → UpgradePrompt — there
 * is no "premium" tier; FarmTier is basic | advanced | consulting). It is
 * REUSE not rebuild: the Camp axis mounts the self-contained
 * <ProfitPerCampSection>; the Animal/Category axes render the disposed-inclusive
 * + projected per-animal view (getAnimalProfitabilityView); the underperformer
 * panel reuses the Triage detections (open-cow / unprofitable /
 * repeated-treatments / poor-doer). The farm P&L + ledger stay on /finansies.
 */

/** The underperformer reasons surfaced on the profitability page (CONTEXT.md). */
const UNDERPERFORMER_REASONS: ReadonlySet<ReasonId> = new Set<ReasonId>([
  "open-cow",
  "unprofitable",
  "repeated-treatments",
  "poor-doer",
]);

export default async function ProfitabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const { farmSlug } = await params;

  await requireSession(`/${farmSlug}/admin/profitability`);

  const { from, to } = searchParams ? await searchParams : {};

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Profitability" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found.</p>;

  const mode = await getFarmMode(farmSlug);

  // Per-animal disposed-inclusive realised + projected view (Animal & Category
  // axes). Unranged = lifetime banked margin, the right lens for "which animals
  // make money" (the Camp axis self-defaults to a trailing-365-day window).
  const dateRange = from && to ? { from, to } : undefined;
  const rows = await getAnimalProfitabilityView(prisma, dateRange);

  // Underperformer panel: reuse the Triage detections, filtered to the
  // money/management reasons. Thresholds mirror app/.../triage/page.tsx.
  const settings = await prisma.farmSettings.findFirst();
  const thresholds = {
    adgPoorDoerThreshold: settings?.adgPoorDoerThreshold ?? 0.7,
    calvingAlertDays: settings?.calvingAlertDays ?? 14,
    daysOpenLimit: settings?.daysOpenLimit ?? 365,
    campGrazingWarningDays: settings?.campGrazingWarningDays ?? 7,
    staleCampInspectionHours: settings?.alertThresholdHours ?? 48,
    repeatedTreatmentCount: settings?.repeatedTreatmentCount ?? 3,
    repeatedTreatmentWindowDays: settings?.repeatedTreatmentWindowDays ?? 90,
  };
  const triageItems = await getTriage(prisma, farmSlug, thresholds, mode);

  // Keep only animals carrying ≥1 underperformer reason; narrate + label
  // server-side so the client host stays presentation-only.
  const underperformers: UnderperformerRow[] = triageItems
    .filter((it) => it.reasons.some((r) => UNDERPERFORMER_REASONS.has(r.id as ReasonId)))
    .map((it) => {
      const relevant = it.reasons.filter((r) => UNDERPERFORMER_REASONS.has(r.id as ReasonId));
      return {
        animalId: it.animalId,
        severity: it.severity,
        reasonLabels: relevant.map((r) => reasonLabel(r.id as ReasonId)),
        narration: narrateTriageItem(it),
        advisory: it.advisory,
      };
    });

  return (
    <AdminPage>
      <PageHeader
        className="px-0 py-0 mb-8"
        title="Profitability"
        subtitle="which animals & groups make money — realised + projected"
      />
      <ProfitabilityClient
        farmSlug={farmSlug}
        rows={rows}
        underperformers={underperformers}
        defaultAxis="camp"
        campSection={
          <Suspense
            fallback={
              <div
                className="h-48 rounded-xl animate-pulse"
                style={{ background: "var(--ft-surface)" }}
              />
            }
          >
            <ProfitPerCampSection farmSlug={farmSlug} from={from} to={to} />
          </Suspense>
        }
      />
    </AdminPage>
  );
}
