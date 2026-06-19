export const dynamic = "force-dynamic";
import { Suspense } from "react";
import Link from "next/link";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { getCachedFarmSettings } from "@/lib/server/cached";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { parseAiSettings, effectiveAssistantName } from "@/lib/einstein/settings-schema";
import DashboardContent from "@/components/admin/DashboardContent";
import { PageHeader, Icon } from "@/components/ds";
import type { FarmTier } from "@/lib/tier";


// ── Skeleton components (restyled to .ft-card placeholders) ───────────────────

function KpiRibbonSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="ft-card" style={{ padding: 15 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="h-8 w-8 rounded" style={{ background: "var(--ft-surface2)" }} />
            <div className="h-2 w-2 rounded-full" style={{ background: "var(--ft-border)" }} />
          </div>
          <div className="h-6 w-14 rounded mb-2" style={{ background: "var(--ft-surface2)" }} />
          <div className="h-2.5 w-16 rounded mb-2" style={{ background: "var(--ft-border)" }} />
          <div className="h-2.5 w-20 rounded" style={{ background: "var(--ft-border)" }} />
        </div>
      ))}
    </div>
  );
}

function CommandBodySkeleton() {
  return (
    <div className="grid gap-4 items-start grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1.3fr_1fr_.9fr]">
      {Array.from({ length: 3 }).map((_, col) => (
        <div key={col} className="flex flex-col gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="ft-card animate-pulse"
              style={{ padding: "var(--ft-card-pad)", minHeight: 160 }}
            >
              <div className="h-3 w-28 rounded mb-3" style={{ background: "var(--ft-surface2)" }} />
              <div className="flex flex-col gap-2">
                <div className="h-4 rounded" style={{ background: "var(--ft-border)" }} />
                <div className="h-4 w-4/5 rounded" style={{ background: "var(--ft-border)" }} />
                <div className="h-4 w-3/5 rounded" style={{ background: "var(--ft-border)" }} />
              </div>
            </div>
          ))}
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
  // Issue #225: read the persisted FarmMode cookie and thread `mode` into
  // every cached helper behind the dashboard so the headline numbers
  // (active animal count, repro stats, health issues, inspected today,
  // recent incidents, alerts) reflect the active species, not the whole
  // farm. Falls back to "cattle" when no cookie is present (see
  // getFarmMode), preserving Basson regression behaviour.
  const [prisma, creds, farmSettings, mode] = await Promise.all([
    getPrismaForFarm(farmSlug),
    getFarmCreds(farmSlug),
    getCachedFarmSettings(farmSlug),
    getFarmMode(farmSlug),
  ]);
  const tier = (creds?.tier ?? "advanced") as FarmTier;
  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[var(--ft-bg)] items-center justify-center">
        <p className="text-[var(--ft-crit)]">Farm not found.</p>
      </div>
    );
  }

  const today = new Date().toISOString().split("T")[0];

  // Resolve the tenant's (possibly renamed) assistant name so the dashboard
  // CTAs/eyebrow honour it — never hardcode "Einstein" (assistant-name contract).
  const aiRow = await prisma.farmSettings
    .findFirst({ select: { aiSettings: true } })
    .catch(() => null);
  const assistantName = effectiveAssistantName(parseAiSettings(aiRow?.aiSettings));

  return (
    <div className="ft-scope min-w-0" style={{ background: "var(--ft-bg)", padding: "28px 32px 80px", maxWidth: 1560, margin: "0 auto" }}>
      {/* Header — renders immediately. Fraunces "Operations" + mono control-room
          subtitle, Export + Ask Einstein actions, with the live weather widget. */}
      <PageHeader
        className="px-0 py-0 mb-5"
        title={<span style={{ fontSize: 36 }}>Operations</span>}
        subtitle={`${today} · control room`}
        right={
          <div className="flex items-center gap-2">
            <Link href={`/${farmSlug}/admin/reports`} className="ft-btn">
              <Icon.download size={14} /> Export
            </Link>
            <Link href={`/${farmSlug}/admin/einstein`} className="ft-btn ft-btn-primary">
              <Icon.einstein size={14} /> Ask {assistantName}
            </Link>
          </div>
        }
      />

      {/* Data-dependent content streams in once ready. Weather now lives inside
          the command body's third column (frozen-design Operations), not the
          header — see DashboardContent. */}
      <Suspense
        fallback={
          <>
            <KpiRibbonSkeleton />
            <CommandBodySkeleton />
          </>
        }
      >
        <DashboardContent farmSlug={farmSlug} prisma={prisma} tier={tier} mode={mode} assistantName={assistantName} latitude={farmSettings.latitude} longitude={farmSettings.longitude} />
      </Suspense>
    </div>
  );
}
