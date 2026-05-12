export const dynamic = "force-dynamic";
import { Suspense } from "react";
import AnimalsTable from "@/components/admin/AnimalsTable";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import RecordBirthButton from "@/components/admin/RecordBirthButton";
import ExportButton from "@/components/admin/ExportButton";
import AnimalAnalyticsSection from "@/components/admin/AnimalAnalyticsSection";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { ACTIVE_STATUS } from "@/lib/animals/active-species-filter";
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { Camp, Mob, PrismaAnimal } from "@/lib/types";
import AdminPage from "@/app/_components/AdminPage";

// SSR page size. 50 keeps the initial HTML payload under ~100 KB for trio-b
// (measured baseline: 557 KB with the old unbounded findMany). The matching
// /api/animals endpoint already supports `?limit=<n>&cursor=<animalId>` for
// subsequent batches so the client "Load more" control streams the rest.
const PAGE_SIZE = 50;

export default async function AdminAnimalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ cursor?: string }>;
}) {
  const { farmSlug } = await params;
  const { cursor } = (searchParams ? await searchParams : {}) ?? {};
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <AdminPage>
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-red-500">Farm not found.</p>
        </div>
      </AdminPage>
    );
  }

  const mode = await getFarmMode(farmSlug);

  // Cursor pagination over `animalId` (unique). We order only by `animalId`
  // when paginating so a single monotonic cursor is sufficient — matching
  // the shape of /api/animals?cursor=<animalId>. When there is no cursor we
  // can still keep the richer `[category, animalId]` sort for the first
  // page because the cursor is empty.
  //
  // Issue #205 — also fetch:
  //   * speciesTotal       — count of Active rows for the current mode, so
  //                          the header denominator is stable as Load more
  //                          streams batches in.
  //   * crossSpeciesTotal  — count of Active rows across ALL species, so a
  //                          per-species view on a multi-species farm can
  //                          surface the reconciliation total ("101 total
  //                          Active across species") and the missing 20
  //                          non-cattle rows aren't invisible.
  // Wave 224: per-species reads routed through `scoped(prisma, mode)` so
  // the species axis is injected by construction (PRD #222). The facade
  // injects { species: mode, status: "Active" } on animal.findMany and
  // { species: mode } on animal.count — both predicates match what this
  // page used pre-#224 via `activeSpeciesWhere(mode)`.
  const speciesPrisma = scoped(prisma, mode);
  const [animals, prismaCamps, withdrawalAnimals, prismaMobs, speciesTotal, crossSpeciesTotal] = await Promise.all([
    speciesPrisma.animal.findMany({
      orderBy: cursor
        ? { animalId: "asc" }
        : [{ category: "asc" }, { animalId: "asc" }],
      take: PAGE_SIZE,
      ...(cursor
        ? { cursor: { animalId: cursor }, skip: 1 }
        : {}),
    }),
    // audit-allow-findmany: camp list is per-tenant and bounded (trio-b ≈ 36 camps); needed for filter dropdown.
    speciesPrisma.camp.findMany({ orderBy: { campName: "asc" } }),
    getAnimalsInWithdrawal(prisma),
    // audit-allow-findmany: mob list is per-tenant and bounded (≤20 typical); needed for table column map.
    speciesPrisma.mob.findMany({ orderBy: { name: "asc" } }),
    speciesPrisma.animal.count({ where: { status: ACTIVE_STATUS } }),
    // cross-species by design: drives the reconciliation total in the header
    // on multi-species tenants. Matches `getCachedFarmSummary` (lib/server/cached.ts).
    // audit-allow-species-where: dashboard reconciliation total spans species
    prisma.animal.count({ where: { status: ACTIVE_STATUS } }),
  ]);

  const withdrawalIds = new Set(withdrawalAnimals.map((w) => w.animalId));

  const camps: Camp[] = prismaCamps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
    size_hectares: c.sizeHectares ?? undefined,
    water_source: c.waterSource ?? undefined,
  }));

  const mobs: Mob[] = prismaMobs.map((m) => ({
    id: m.id,
    name: m.name,
    current_camp: m.currentCamp,
  }));

  // A full page came back ⇒ there is probably more. The API endpoint returns
  // a definitive `hasMore`, so the client can drop the button the moment it
  // runs out. Pass `nextCursor` only when we saw a full page.
  const nextCursor =
    animals.length === PAGE_SIZE ? animals[animals.length - 1].animalId : null;

  return (
    <AdminPage>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1815]">Animal Catalogue</h1>
          {/* Header count line moved into <AnimalsTable /> (issue #205) so the
              "Showing X of Y" denominator updates as Load more streams the
              next cursor window, and so multi-species tenants see the
              cross-species reconciliation total alongside. */}
        </div>
        <div className="flex gap-2 items-center">
          <ExportButton farmSlug={farmSlug} exportType="animals" species={mode} />
          <RecordBirthButton animals={animals as unknown as PrismaAnimal[]} camps={camps} />
        </div>
      </div>
      <AnimalsTable
        animals={animals as unknown as PrismaAnimal[]}
        camps={camps}
        farmSlug={farmSlug}
        withdrawalIds={withdrawalIds}
        mobs={mobs}
        initialNextCursor={nextCursor}
        species={mode}
        speciesTotal={speciesTotal}
        crossSpeciesActiveTotal={crossSpeciesTotal}
      />
      <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
        <AnimalAnalyticsSection farmSlug={farmSlug} />
      </Suspense>
      {/*
        Wave C / U4 — Codex audit P2 polish (2026-05-10). Destructive
        "Clear All …" buttons used to live next to the page title. Moved
        here to a footer-level danger zone so a wipe-everything tap is
        a deliberate end-of-page action, not a one-tap-from-anywhere
        risk. ClearSectionButton's two-step confirm UX is unchanged —
        only its placement.
      */}
      <div
        data-testid="danger-zone"
        className="mt-12 pt-6 border-t border-[#E8DFD2]"
      >
        <p
          className="text-xs uppercase tracking-wider mb-3"
          style={{ color: "#9C8E7A" }}
        >
          Danger zone
        </p>
        <ClearSectionButton endpoint="/api/animals/reset" label="Clear All Animals" />
      </div>
    </AdminPage>
  );
}
