import { Suspense } from "react";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import DashboardContent from "@/components/admin/DashboardContent";
import WeatherWidget from "@/components/dashboard/WeatherWidget";
import type { FarmTier } from "@/lib/tier";


// ── Skeleton components ───────────────────────────────────────────────────────

function StatBarSkeleton() {
  return (
    <div
      className="rounded-2xl overflow-hidden mb-6 animate-pulse"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="p-3 sm:p-4" style={{ borderRight: i < 8 ? "1px solid rgba(139,105,20,0.12)" : undefined }}>
            <div className="h-3 w-16 bg-zinc-200 rounded mb-3" />
            <div className="h-7 w-12 bg-zinc-200 rounded mb-2" />
            <div className="h-2.5 w-20 bg-zinc-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertPanelSkeleton() {
  return (
    <div
      className="rounded-xl p-4 mb-6 animate-pulse"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <div className="h-3 w-32 bg-zinc-200 rounded mb-3" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 bg-zinc-100 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function BottomGridSkeleton() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl p-4 animate-pulse"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8", minHeight: 160 }}
        >
          <div className="h-3 w-28 bg-zinc-200 rounded mb-3" />
          <div className="flex flex-col gap-2">
            <div className="h-4 bg-zinc-100 rounded" />
            <div className="h-4 bg-zinc-100 rounded w-4/5" />
            <div className="h-4 bg-zinc-100 rounded w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page shell (renders instantly) ───────────────────────────────────────────

export default async function AdminPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const [prisma, creds] = await Promise.all([
    getPrismaForFarm(farmSlug),
    getFarmCreds(farmSlug),
  ]);
  const tier = (creds?.tier ?? "advanced") as FarmTier;
  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const farmSettings = await prisma.farmSettings.findFirst({
    select: { latitude: true, longitude: true },
  });

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      {/* Header — renders immediately */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#1C1815]">Operations Overview</h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
            {new Date().toISOString().split("T")[0]} · Farm Management
          </p>
        </div>
        {/* Weather widget in admin header */}
        <div className="sm:max-w-sm w-full">
          <WeatherWidget
            latitude={farmSettings?.latitude ?? null}
            longitude={farmSettings?.longitude ?? null}
          />
        </div>
      </div>

      {/* Data-dependent content streams in once ready */}
      <Suspense
        fallback={
          <>
            <StatBarSkeleton />
            <AlertPanelSkeleton />
            <BottomGridSkeleton />
          </>
        }
      >
        <DashboardContent farmSlug={farmSlug} prisma={prisma} tier={tier} />
      </Suspense>
    </div>
  );
}
