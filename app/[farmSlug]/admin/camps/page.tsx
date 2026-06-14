export const dynamic = "force-dynamic";
import { Suspense } from "react";
import AddCampForm from "@/components/admin/AddCampForm";
import CampsTable from "@/components/admin/CampsTable";
import CampAnalyticsSection from "@/components/admin/CampAnalyticsSection";
import PerformanceSection from "@/components/admin/PerformanceSection";
import RainfallSection from "@/components/admin/RainfallSection";
import RotationSection from "@/components/admin/rotation/RotationSection";
import CampsTabBar from "@/components/admin/CampsTabBar";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import type { Camp } from "@/lib/types";
import { getFarmSummary as getVeldSummary } from "@/lib/server/veld-score";
import { VeldTab } from "@/components/admin/camps/VeldTab";
import { getFarmFeedOnOfferPayload } from "@/lib/server/feed-on-offer";
import { FeedOnOfferTab } from "@/components/admin/camps/FeedOnOfferTab";
import AdminPage from "@/app/_components/AdminPage";
import { PageHeader } from "@/components/ds";


// Advanced-tier only tabs. The `camps` overview and `rainfall` tab stay
// accessible to all tiers; the tabs below mirror gated /tools/* routes and
// must render an UpgradePrompt for basic-tier farms.
const ADVANCED_TABS: Record<string, string> = {
  performance: "Performance Analytics",
  rotation: "Rotation Planning",
  veld: "Veld Condition Scoring",
  "feed-on-offer": "Feed-on-Offer",
};

export default async function AdminCampsPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const { farmSlug } = await params;
  const sp = await searchParams;
  const activeTab = sp?.tab ?? "camps";
  const from = sp?.from;
  const to = sp?.to;

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <AdminPage>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-[var(--ft-crit)]">Farm not found.</p>
        </div>
      </AdminPage>
    );
  }

  const creds = await getFarmCreds(farmSlug);
  const tier = creds?.tier ?? "basic";
  const isBasic = tier === "basic";
  const gatedFeature =
    isBasic && ADVANCED_TABS[activeTab] ? ADVANCED_TABS[activeTab] : null;

  // Skip heavy queries for advanced tabs the basic tier can't view.
  const needsVeldSummary = !gatedFeature && activeTab === "veld";
  const needsFeedOnOffer = !gatedFeature && activeTab === "feed-on-offer";

  // Camps are cross-species infrastructure — a physical camp grazes
  // whatever species is on it, regardless of the active FarmMode. The
  // admin camps overview must list every camp on the farm (ADR-0005;
  // same reclassification PR #373/#364 made on the map pages and #390
  // made on the camp-by-id surfaces — S25/sp-M1 closes the last
  // divergent `scoped()` outlier on this surface). The per-species
  // namespace pages (e.g. /sheep/camps) stay intentionally scoped.
  const [prismaCampsRaw, veldSummary, feedOnOfferPayload] = await Promise.all([
    crossSpecies(prisma, "farm-wide-audit").camp.findMany({ orderBy: { campName: "asc" } }),
    needsVeldSummary ? getVeldSummary(prisma) : Promise.resolve(null),
    needsFeedOnOffer ? getFarmFeedOnOfferPayload(prisma) : Promise.resolve(null),
  ]);
  const prismaCamps = prismaCampsRaw;
  const camps: Camp[] = prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
    geojson: c.geojson ?? undefined,
    color: c.color ?? undefined,
  }));

  return (
    <AdminPage>
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Camps"
        subtitle={`${camps.length} grazing camps · management & performance`}
      />

      <CampsTabBar activeTab={activeTab} farmSlug={farmSlug} />

      {activeTab === "camps" && (
        <>
          <AddCampForm />
          <CampsTable camps={camps} farmSlug={farmSlug} />
          <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "var(--ft-surface)" }} />}>
            <CampAnalyticsSection farmSlug={farmSlug} />
          </Suspense>
        </>
      )}

      {gatedFeature && (
        <UpgradePrompt feature={gatedFeature} farmSlug={farmSlug} />
      )}

      {!gatedFeature && activeTab === "performance" && (
        <Suspense fallback={<div className="mt-4 h-64 rounded-xl animate-pulse" style={{ background: "var(--ft-surface)" }} />}>
          <PerformanceSection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
      )}

      {activeTab === "rainfall" && (
        <Suspense fallback={<div className="mt-4 h-64 rounded-xl animate-pulse" style={{ background: "var(--ft-surface)" }} />}>
          <RainfallSection farmSlug={farmSlug} camps={camps} />
        </Suspense>
      )}

      {!gatedFeature && activeTab === "rotation" && (
        <Suspense fallback={<div className="mt-4 h-64 rounded-xl animate-pulse" style={{ background: "var(--ft-surface)" }} />}>
          <RotationSection farmSlug={farmSlug} camps={camps} />
        </Suspense>
      )}

      {!gatedFeature && activeTab === "veld" && veldSummary && (
        <VeldTab farmSlug={farmSlug} summary={veldSummary} />
      )}

      {!gatedFeature && activeTab === "feed-on-offer" && feedOnOfferPayload && (
        <FeedOnOfferTab farmSlug={farmSlug} payload={feedOnOfferPayload} />
      )}
    </AdminPage>
  );
}
