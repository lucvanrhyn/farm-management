export const dynamic = "force-dynamic";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { scoped } from "@/lib/server/species-scoped-prisma";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import AdminPage from "@/app/_components/AdminPage";
import SheepObservationsPageClient from "./SheepObservationsPageClient";

/**
 * `/[farmSlug]/sheep/observations` — issue #231.
 *
 * Sheep mirror of `app/[farmSlug]/admin/observations/page.tsx`. Forces
 * `species = "sheep"` (the route IS the species axis — same rationale
 * as `/sheep/animals` and `/sheep/camps`, see ADR-0003). A user who
 * deep-links here while their farm-mode cookie still reads `cattle`
 * must still get sheep observations — so we do NOT read
 * `getFarmMode(farmSlug)` for the observation filter. We pass a
 * hard-coded `"sheep"` into the species-scoped Prisma facade.
 *
 * The facade (`scoped(prisma, "sheep").observation.findMany(...)`)
 * injects `where: { species: "sheep" }` per the contract documented in
 * `lib/server/species-scoped-prisma.ts`. Per ADR-0004, that predicate
 * is a strict literal — observations with `species: null` (legacy rows
 * pre-backfill, or where the owning animal was deleted) are
 * intentionally excluded from this feed. The cross-species follow-up
 * (a farm-wide audit log) is out of scope for this slice; if needed it
 * lives at a separate route through the `crossSpecies()` door
 * (ADR-0005) rather than relaxing the per-species predicate here.
 *
 * Species-aware client timeline (#496)
 * ─────────────────────────────────────
 * #491 grew `/api/observations` an OPT-IN `?species=<x>` param. The sheep
 * timeline now consumes `/api/observations?species=sheep` on the client
 * (`<SheepObservationsTimeline />`) instead of the old SSR facade. The route
 * IS the species axis (ADR-0003), so the literal "sheep" param scopes the
 * feed regardless of the farm-mode cookie — there is no cross-species
 * flicker because the endpoint narrows server-side. This page therefore no
 * longer SSR-fetches the observation slice; it only prefetches the
 * animal/camp lists the create-observation modal's autocomplete needs.
 *
 * Allow-list note: the create-observation modal continues to be the
 * client-driven `<ObservationsPageClient />` shape — the modal is
 * already species-aware via the `species` prop (it forwards into
 * `<CreateObservationModal />` which uses it to filter the animal
 * picker). We pass `species="sheep"` there too.
 *
 * Basson regression: the cattle admin observations page
 * (`app/[farmSlug]/admin/observations/page.tsx`) is untouched by this
 * wave — its `species: mode` predicate continues to bind to `cattle`
 * for a cattle-only tenant like Basson Boerdery.
 */
const PAGE_SIZE = 50;
const SPECIES = "sheep" as const;

export default async function SheepObservationsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Observations Trail" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <AdminPage>
        <div className="flex-1 min-w-0">
          <p className="text-red-500">Farm not found.</p>
        </div>
      </AdminPage>
    );
  }

  const speciesPrisma = scoped(prisma, SPECIES);

  // Prefetch the animal/camp lists the create-observation modal's autocomplete
  // needs. The visible timeline no longer SSR-fetches observations — it consumes
  // the species-aware `/api/observations?species=sheep` endpoint client-side
  // (#496). Both prefetch calls flow through the facade so the species axis is
  // structurally enforced (ADR-0005).
  const [prismaAnimals, prismaCamps] = await Promise.all([
    speciesPrisma.animal.findMany({
      orderBy: { animalId: "asc" },
      take: PAGE_SIZE,
      select: { animalId: true, currentCamp: true },
    }),
    // audit-allow-findmany: camp list is per-tenant and bounded; needed for create-modal dropdown.
    speciesPrisma.camp.findMany({
      orderBy: { campName: "asc" },
      select: { campId: true, campName: true },
    }),
  ]);

  const camps = prismaCamps.map((c) => ({ id: c.campId, name: c.campName }));
  const animals = prismaAnimals.map((a) => ({
    id: a.animalId,
    tag: a.animalId,
    campId: a.currentCamp,
  }));

  return (
    <AdminPage>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1C1815]">Sheep Observations</h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          Recent entries · sheep flock only
        </p>
      </div>

      {/*
        #496 — the visible timeline is owned by the page client now: it
        fetches `/api/observations?species=sheep` and re-fetches on a create
        (refreshKey bump), so this server component only prefetches the
        create-modal autocomplete data.
      */}
      <SheepObservationsPageClient camps={camps} animals={animals} species={SPECIES} />

      {/*
        Danger zone parity with the cattle observations page — destroying
        the entire observation log is an explicit end-of-page action.
        Note: the existing /api/observations/reset endpoint is species-
        blind today (same surface the cattle page uses). Wiring it to
        species-scope is a follow-up — out of scope for this slice. The
        button is intentionally kept so a Basson-equivalent sheep tenant
        has feature parity in the UX.
      */}
      <div data-testid="danger-zone" className="mt-12 pt-6 border-t border-[#E8DFD2]">
        <p className="text-xs uppercase tracking-wider mb-3" style={{ color: "#9C8E7A" }}>
          Danger zone
        </p>
        <ClearSectionButton endpoint="/api/observations/reset" label="Clear All Observations" />
      </div>
    </AdminPage>
  );
}
