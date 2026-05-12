export const dynamic = "force-dynamic";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { scoped } from "@/lib/server/species-scoped-prisma";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import AdminPage from "@/app/_components/AdminPage";
import SheepObservationsPageClient from "./SheepObservationsPageClient";
import SheepObservationsTimeline from "./SheepObservationsTimeline";

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
 * lives at a separate route with an explicit
 * `audit-allow-species-where:` pragma rather than relaxing the per-
 * species predicate here.
 *
 * Server-rendered timeline rationale
 * ──────────────────────────────────
 * The cattle `/admin/observations` page hands the visible timeline to
 * `<ObservationsLog />`, a client component that fetches
 * `/api/observations` on mount. That API endpoint is species-blind
 * today (`lib/domain/observations/list-observations.ts` filters by
 * camp/type/animalId only). Reusing `<ObservationsLog />` here would
 * paint sheep observations on first render (server data) then flicker
 * cattle observations in on hydration when the API returns. To keep
 * the slice tight and the species axis structurally enforced, we
 * render a small server-side timeline (`SheepObservationsTimeline`)
 * fed directly off the facade — no API hop, no species ambiguity. A
 * follow-up wave can extend `/api/observations` to accept a `species`
 * query param and unify the two timelines.
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
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ cursor?: string }>;
}) {
  const { farmSlug } = await params;
  const { cursor } = (searchParams ? await searchParams : {}) ?? {};

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

  // SSR fetch the observation slice (sheep-only, paginated by observedAt
  // DESC), plus the animal/camp prefetches the create-observation modal
  // needs for its autocomplete. All three calls flow through the facade
  // so the species axis is structurally enforced — the
  // `audit-species-where` gate doesn't need to scan this file.
  const [observations, prismaAnimals, prismaCamps] = await Promise.all([
    speciesPrisma.observation.findMany({
      orderBy: { observedAt: "desc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        campId: true,
        animalId: true,
        details: true,
        observedAt: true,
        loggedBy: true,
      },
    }),
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
          {observations.length} recent {observations.length === 1 ? "entry" : "entries"} · sheep flock only
        </p>
      </div>

      <SheepObservationsPageClient camps={camps} animals={animals} species={SPECIES} />

      <SheepObservationsTimeline
        observations={observations.map((o) => ({
          id: o.id,
          type: o.type,
          campId: o.campId,
          animalId: o.animalId,
          details: o.details,
          observedAt: o.observedAt.toISOString(),
          loggedBy: o.loggedBy,
        }))}
      />

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
