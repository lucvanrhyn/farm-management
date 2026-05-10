export const dynamic = "force-dynamic";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { getFarmCreds } from "@/lib/meta-db";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import ObservationsPageClient from "./ObservationsPageClient";
import AdminPage from "@/app/_components/AdminPage";

// Page size for the animals autocomplete prefetch that's serialised into the
// observation-create modal. The visible observations timeline itself is
// paginated client-side via /api/observations?limit=50&offset=…, so the only
// SSR payload driver on this page is this animals prefetch. Without a cap,
// trio-b's 874 Active animals add ~120 KB to the HTML document. Cap at 50
// here. Animals outside the slice are reachable via the modal's debounced
// `AnimalPicker` (Phase H) which talks to /api/animals?search=<q>; the
// prefetch stays as the no-network "quick-pick from this camp" fast path.
const PAGE_SIZE = 50;

export default async function AdminObservationsPage({
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

  const mode = await getFarmMode(farmSlug);

  const [prismaCamps, prismaAnimals] = await Promise.all([
    // audit-allow-findmany: camps are bounded per tenant (trio-b ≈ 36); dropdown needs full list.
    prisma.camp.findMany({ orderBy: { campName: "asc" }, select: { campId: true, campName: true } }),
    prisma.animal.findMany({
      where: { status: "Active", species: mode },
      orderBy: { animalId: "asc" },
      take: PAGE_SIZE,
      select: { animalId: true, currentCamp: true },
      ...(cursor
        ? { cursor: { animalId: cursor }, skip: 1 }
        : {}),
    }),
  ]);

  const camps = prismaCamps.map((c) => ({ id: c.campId, name: c.campName }));
  const animals = prismaAnimals.map((a) => ({ id: a.animalId, tag: a.animalId, campId: a.currentCamp }));

  return (
    <AdminPage>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1C1815]">Observations</h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>All field observations — filter and edit</p>
      </div>
      <ObservationsPageClient camps={camps} animals={animals} species={mode} />
      {/*
        Wave C / U4 — see animals/page.tsx for full rationale. Danger zone
        sits at the bottom so destroying the entire observations log is an
        intentional end-of-page action.
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
        <ClearSectionButton endpoint="/api/observations/reset" label="Clear All Observations" />
      </div>
    </AdminPage>
  );
}
