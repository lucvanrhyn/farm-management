// app/[farmSlug]/admin/animals/[id]/page.tsx
//
// Per-animal detail page. Server component: data fetching + tab
// dispatch. Each tab body lives in `_components/` so this shell stays
// the load-bearing data path.
//
// `force-dynamic` is required (Wave 2): this page reads from the
// per-tenant Prisma client which depends on a per-request cookie.

export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ds";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { scoped, crossSpecies } from "@/lib/server/species-scoped-prisma";
import type { SpeciesId } from "@/lib/species/types";
import { getCategoryLabel, getCategoryChipColor } from "@/lib/utils";
import type { AnimalCategory } from "@/lib/types";
import AnimalActions from "@/components/admin/finansies/AnimalActions";
import { getAnimalWeightData } from "@/lib/server/weight-analytics";
import { getCostPerAnimal } from "@/lib/server/financial-analytics";
import { getAnimalPhotos } from "@/lib/server/animal-photos";
import { BASE_TABS, PROGENY_TAB, type TabKey } from "./_components/tabs";
import EditAnimalButton from "./_components/EditAnimalButton";
import { OverviewTab } from "./_components/OverviewTab";
import { ReproductionTab } from "./_components/ReproductionTab";
import { HealthTab } from "./_components/HealthTab";
import { MovementTab } from "./_components/MovementTab";
import { WeightTab } from "./_components/WeightTab";
import { InvestmentTab } from "./_components/InvestmentTab";
import { ProgenyTab } from "./_components/ProgenyTab";
import { AnimalPhotosTab } from "@/components/admin/AnimalPhotosTab";

export default async function AnimalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { farmSlug, id } = await params;
  const { tab: rawTab } = await searchParams;

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found.</p>;
  const animal = await prisma.animal.findUnique({ where: { animalId: id } });
  if (!animal) notFound();

  const isBull = animal.category === "Bull";

  const [observations, camp, weightData, investmentData, offspring, allCamps, photos] = await Promise.all([
    scoped(prisma, animal.species as SpeciesId).observation.findMany({
      where: { animalId: id },
      orderBy: { observedAt: "desc" },
      take: 200,
    }),
    scoped(prisma, animal.species as SpeciesId).camp.findFirst({ where: { campId: animal.currentCamp } }),
    getAnimalWeightData(prisma, id),
    getCostPerAnimal(prisma, id),
    isBull
      ? // Offspring lineage must include Sold/Deceased progeny — `scoped()`
        // would inject status: "Active" and silently hide them (the issue
        // #255 status-trap class). Route through crossSpecies() keeping the
        // explicit species filter so the species axis stays correct without
        // a status injection.
        crossSpecies(prisma, "species-registry-internal").animal.findMany({
          where: { fatherId: animal.animalId, species: animal.species },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    // audit-allow-findmany-no-select: per-tenant camp list (≤36 typical) for EditAnimalModal camp picker; modal uses full Camp type
    scoped(prisma, animal.species as SpeciesId).camp.findMany({ orderBy: { campName: "asc" } }),
    // Wave 5a / #264 — photos aggregation for the new Photos tab.
    getAnimalPhotos(prisma, id),
  ]);

  // Fetch calving observations for offspring birth weights & difficulty.
  // A calving is recorded against the DAM (Observation.animalId = dam tag), with
  // the calf's tag in details.calfAnimalId — so we fetch the offspring's DAMS'
  // calvings and match them to each calf by tag in ProgenyTab. Querying by the
  // calf tags returns the wrong rows (a calf's own later calving, or nothing).
  const damTags = isBull
    ? ([...new Set(offspring.map((o) => o.motherId).filter(Boolean))] as string[])
    : [];
  const offspringCalvingObs = damTags.length > 0
    ? await scoped(prisma, animal.species as SpeciesId).observation.findMany({
        where: {
          type: "calving",
          animalId: { in: damTags },
        },
        select: { animalId: true, details: true },
      })
    : [];

  // Build tabs dynamically — add Progeny tab for bulls
  const tabs = isBull ? [...BASE_TABS, PROGENY_TAB] : [...BASE_TABS];
  const activeTab: TabKey = (tabs.map((t) => t.key) as string[]).includes(rawTab ?? "")
    ? (rawTab as TabKey)
    : "overview";

  // Partition observations by tab
  const reproObs = observations.filter((o) =>
    ["heat_detection", "insemination", "pregnancy_scan", "calving"].includes(o.type)
  );
  const healthObs = observations.filter((o) =>
    ["health_issue", "treatment"].includes(o.type)
  );
  const movementObs = observations.filter((o) => o.type === "animal_movement");

  return (
    <div className="min-w-0 p-4 md:p-8 max-w-3xl space-y-4 bg-[var(--ft-bg)]">
        {/* Back */}
        <Link
          href={`/${farmSlug}/admin/animals`}
          className="inline-flex items-center gap-1 text-sm"
          style={{ color: "var(--ft-subtle)" }}
        >
          ← Back to Animals
        </Link>

        {/* Header */}
        <PageHeader
          className="px-0 py-0"
          title={
            <span className="flex items-center gap-3 flex-wrap">
              <span className="font-mono">{animal.animalId}</span>
              {animal.name && <span className="text-lg" style={{ color: "var(--ft-subtle)" }}>— {animal.name}</span>}
              <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${getCategoryChipColor(animal.category as AnimalCategory)}`}>
                {getCategoryLabel(animal.category as AnimalCategory)}
              </span>
            </span>
          }
          subtitle="animal record"
          right={
            animal.status === "Active" ? (
              <div className="flex items-center gap-2">
                <EditAnimalButton animal={animal} camps={allCamps} />
                <AnimalActions animalId={animal.animalId} campId={animal.currentCamp} variant="detail" />
              </div>
            ) : undefined
          }
        />

        {/* Tab bar */}
        <div
          className="flex gap-0 rounded-xl overflow-hidden border"
          style={{ border: "1px solid var(--ft-border)", background: "var(--ft-surface)" }}
        >
          {tabs.map((t) => {
            const isActive = t.key === activeTab;
            return (
              <Link
                key={t.key}
                href={`/${farmSlug}/admin/animals/${id}?tab=${t.key}`}
                className="flex-1 text-center py-2.5 text-xs font-semibold transition-colors"
                style={{
                  background: isActive ? "var(--ft-text)" : "transparent",
                  color: isActive ? "var(--ft-bg)" : "var(--ft-subtle)",
                  borderRight: "1px solid var(--ft-border)",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {activeTab === "overview" && (
          <OverviewTab animal={animal} camp={camp} farmSlug={farmSlug} />
        )}

        {activeTab === "reproduction" && (
          <ReproductionTab reproObs={reproObs} farmSlug={farmSlug} />
        )}

        {activeTab === "health" && (
          <HealthTab healthObs={healthObs} />
        )}

        {activeTab === "movement" && (
          <MovementTab movementObs={movementObs} />
        )}

        {activeTab === "weight" && (
          <WeightTab weightData={weightData} />
        )}

        {activeTab === "investment" && (
          <InvestmentTab investmentData={investmentData} weightData={weightData} />
        )}

        {activeTab === "photos" && (
          <AnimalPhotosTab farmSlug={farmSlug} animalId={id} photos={photos} />
        )}

        {activeTab === "progeny" && isBull && (
          <ProgenyTab
            offspring={offspring}
            offspringCalvingObs={offspringCalvingObs}
            farmSlug={farmSlug}
          />
        )}
    </div>
  );
}
