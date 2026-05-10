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
import { activeSpeciesWhere } from "@/lib/animals/active-species-filter";
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
  const [animals, prismaCamps, withdrawalAnimals, prismaMobs] = await Promise.all([
    prisma.animal.findMany({
      // Wave A2: per-species + Active. Previously `where: { species: mode }`
      // leaked inactive/sold/dead rows into the admin table. Helper keeps
      // this surface in lockstep with CampDetailPanel and any future caller.
      where: activeSpeciesWhere(mode),
      orderBy: cursor
        ? { animalId: "asc" }
        : [{ category: "asc" }, { animalId: "asc" }],
      take: PAGE_SIZE,
      ...(cursor
        ? { cursor: { animalId: cursor }, skip: 1 }
        : {}),
    }),
    // audit-allow-findmany: camp list is per-tenant and bounded (trio-b ≈ 36 camps); needed for filter dropdown.
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
    getAnimalsInWithdrawal(prisma),
    // audit-allow-findmany: mob list is per-tenant and bounded (≤20 typical); needed for table column map.
    prisma.mob.findMany({ orderBy: { name: "asc" } }),
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
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
            Showing first {animals.length.toLocaleString()} · scroll or Load more to see the rest
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <ExportButton farmSlug={farmSlug} exportType="animals" species={mode} />
          <RecordBirthButton animals={animals as unknown as PrismaAnimal[]} camps={camps} />
          <ClearSectionButton endpoint="/api/animals/reset" label="Clear All Animals" />
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
      />
      <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
        <AnimalAnalyticsSection farmSlug={farmSlug} />
      </Suspense>
    </AdminPage>
  );
}
