export const dynamic = "force-dynamic";
import { Suspense } from "react";
import AnimalsTable from "@/components/admin/AnimalsTable";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import RecordBirthButton from "@/components/admin/RecordBirthButton";
import ExportButton from "@/components/admin/ExportButton";
import AnimalAnalyticsSection from "@/components/admin/AnimalAnalyticsSection";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";
import { ACTIVE_STATUS } from "@/lib/animals/active-species-filter";
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { Camp, Mob, PrismaAnimal } from "@/lib/types";
import AdminPage from "@/app/_components/AdminPage";

/**
 * `/[farmSlug]/sheep/animals` — issue #228.
 *
 * Sheep mirror of `app/[farmSlug]/admin/animals/page.tsx`. The mirror is
 * intentional rather than parameterised: the cattle page reads
 * `getFarmMode(farmSlug)` (cookie-driven) so a sheep-mode user lands on
 * sheep there too. Here, the *route* is the species axis — a user who
 * deep-links to `/sheep/animals` while their cookie still reads `cattle`
 * must still get sheep. So we force `species = "sheep"` and route all
 * reads through `scoped(prisma, "sheep")`. The species-scoped facade
 * (PRD #222 / #224) injects `{ species: "sheep", status: "Active" }`
 * on animal.findMany and `{ species: "sheep" }` on camp/mob/count —
 * the same contract documented in `lib/server/species-scoped-prisma.ts`.
 *
 * `AnimalsTable` is already species-parameterised (it accepts
 * `species: SpeciesId` and resolves categories/labels via
 * `getSpeciesModule(species)` so the lambing-vs-calving terminology
 * comes through `lib/species/sheep`). We pass `species="sheep"`.
 *
 * Basson regression: this page is only reachable through the SheepSubNav,
 * which renders inside the sheep layout — Basson is a cattle-only tenant
 * so the `/sheep` landing redirects them to `/admin` before they ever
 * reach this surface. The cattle admin/animals page (`app/[farmSlug]/
 * admin/animals/page.tsx`) is untouched by this wave — its
 * `species: mode` predicate continues to bind to `cattle` for Basson.
 */
const PAGE_SIZE = 50;
const SPECIES = "sheep" as const;

export default async function SheepAnimalsPage({
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

  const speciesPrisma = scoped(prisma, SPECIES);
  const [animals, prismaCamps, withdrawalAnimals, prismaMobs, speciesTotal, crossSpeciesTotal] = await Promise.all([
    speciesPrisma.animal.findMany({
      orderBy: cursor
        ? { animalId: "asc" }
        : [{ category: "asc" }, { animalId: "asc" }],
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { animalId: cursor }, skip: 1 } : {}),
    }),
    // audit-allow-findmany: camp list is per-tenant and bounded; needed for filter dropdown.
    speciesPrisma.camp.findMany({ orderBy: { campName: "asc" } }),
    getAnimalsInWithdrawal(prisma),
    // audit-allow-findmany: mob list is per-tenant and bounded; needed for table column map.
    speciesPrisma.mob.findMany({ orderBy: { name: "asc" } }),
    speciesPrisma.animal.count({ where: { status: ACTIVE_STATUS } }),
    // cross-species by design: drives the reconciliation total in the header
    // for multi-species tenants ("X total Active across species"). Mirrors
    // the cattle admin/animals page behaviour.
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

  const nextCursor =
    animals.length === PAGE_SIZE ? animals[animals.length - 1].animalId : null;

  return (
    <AdminPage>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1815]">Sheep Catalogue</h1>
        </div>
        <div className="flex gap-2 items-center">
          <ExportButton farmSlug={farmSlug} exportType="animals" species={SPECIES} />
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
        species={SPECIES}
        speciesTotal={speciesTotal}
        crossSpeciesActiveTotal={crossSpeciesTotal}
      />
      <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
        <AnimalAnalyticsSection farmSlug={farmSlug} />
      </Suspense>
      <div
        data-testid="danger-zone"
        className="mt-12 pt-6 border-t border-[#E8DFD2]"
      >
        <p className="text-xs uppercase tracking-wider mb-3" style={{ color: "#9C8E7A" }}>
          Danger zone
        </p>
        <ClearSectionButton endpoint="/api/animals/reset" label="Clear All Sheep" />
      </div>
    </AdminPage>
  );
}
