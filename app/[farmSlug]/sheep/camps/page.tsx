export const dynamic = "force-dynamic";
import { Suspense } from "react";
import AddCampForm from "@/components/admin/AddCampForm";
import CampsTable from "@/components/admin/CampsTable";
import CampAnalyticsSection from "@/components/admin/CampAnalyticsSection";
import CampsEmptyState from "@/components/camps/CampsEmptyState";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { Camp } from "@/lib/types";
import AdminPage from "@/app/_components/AdminPage";

/**
 * `/[farmSlug]/sheep/camps` — issue #229.
 *
 * Sheep mirror of the cattle camps surface. Forces `species = "sheep"`
 * (the route IS the species axis — same rationale as `/sheep/animals`).
 *
 * The schema (`Camp.species` NOT NULL, composite unique on `(species,
 * campId)`, migrations 0010/0011) allows the same `campId` value to
 * coexist across cattle and sheep. The species-scoped facade
 * (`scoped(prisma, "sheep").camp.findMany`) injects `{ species: "sheep" }`
 * so this page renders only the sheep camps even when a cattle camp
 * with the same `campId` exists.
 *
 * Scope intentionally minimal (tracer bullet): camps list + add form +
 * analytics. Advanced tabs (performance / rotation / veld / feed-on-offer)
 * remain cattle-only at the cattle admin/camps page until per-species
 * support lands — a follow-up wave will lift them if needed.
 */
export default async function SheepCampsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <AdminPage>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-red-500">Farm not found.</p>
        </div>
      </AdminPage>
    );
  }

  const speciesPrisma = scoped(prisma, "sheep");
  // audit-allow-findmany: camp list is per-tenant and bounded (trio-b ≈ 36 camps).
  const prismaCamps = await speciesPrisma.camp.findMany({
    orderBy: { campName: "asc" },
  });

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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1C1815]">Sheep Camps</h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          {camps.length} camps · sheep grazing surface
        </p>
      </div>

      <AddCampForm />

      {camps.length === 0 ? (
        // Zero sheep camps for the active species → actionable onboarding
        // guidance instead of a headerless/empty table (#288). The add form
        // stays above so the primary action is always one tap away.
        <CampsEmptyState farmSlug={farmSlug} speciesLabel="sheep" />
      ) : (
        <>
          <CampsTable camps={camps} farmSlug={farmSlug} />

          <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
            <CampAnalyticsSection farmSlug={farmSlug} />
          </Suspense>
        </>
      )}
    </AdminPage>
  );
}
