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
import { getFarmCreds } from "@/lib/meta-db";
import type { Camp } from "@/lib/types";
import { getFarmSummary as getVeldSummary } from "@/lib/server/veld-score";
import { VeldTab } from "@/components/admin/camps/VeldTab";
import { getFarmFeedOnOfferPayload } from "@/lib/server/feed-on-offer";
import { FeedOnOfferTab } from "@/components/admin/camps/FeedOnOfferTab";


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
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
      </div>
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

  const [prismaCampsRaw, veldSummary, feedOnOfferPayload] = await Promise.all([
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
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
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1C1815]">Camps</h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          {camps.length} camps · management and performance
        </p>
      </div>

      <CampsTabBar activeTab={activeTab} farmSlug={farmSlug} />

      {activeTab === "camps" && (
        <>
          <AddCampForm />
          <CampsTable camps={camps} farmSlug={farmSlug} />
          <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
            <CampAnalyticsSection farmSlug={farmSlug} />
          </Suspense>
        </>
      )}

      {gatedFeature && (
        <UpgradePrompt feature={gatedFeature} farmSlug={farmSlug} />
      )}

      {!gatedFeature && activeTab === "performance" && (
        <Suspense fallback={<div className="mt-4 h-64 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <PerformanceSection farmSlug={farmSlug} from={from} to={to} />
        </Suspense>
      )}

      {activeTab === "rainfall" && (
        <Suspense fallback={<div className="mt-4 h-64 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <RainfallSection farmSlug={farmSlug} camps={camps} />
        </Suspense>
      )}

      {!gatedFeature && activeTab === "rotation" && (
        <Suspense fallback={<div className="mt-4 h-64 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <RotationSection farmSlug={farmSlug} camps={camps} />
        </Suspense>
      )}

      {!gatedFeature && activeTab === "veld" && veldSummary && (
        <VeldTab farmSlug={farmSlug} summary={veldSummary} />
      )}

      {!gatedFeature && activeTab === "feed-on-offer" && feedOnOfferPayload && (
        <FeedOnOfferTab farmSlug={farmSlug} payload={feedOnOfferPayload} />
      )}
    </div>
  );
}
