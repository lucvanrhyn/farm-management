export const dynamic = "force-dynamic";

import { getPrismaForFarm } from "@/lib/farm-prisma";
import {
  getBreedingSnapshot,
  suggestPairings,
  detectInbreedingRisk,
} from "@/lib/server/breeding-analytics";
import BreedingDashboard from "@/components/admin/BreedingDashboard";
import NoPedigreeEmptyState from "@/components/admin/breeding/NoPedigreeEmptyState";
import { getFarmCreds } from "@/lib/meta-db";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { scoped } from "@/lib/server/species-scoped-prisma";

export default async function BreedingAIPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Breeding AI" farmSlug={farmSlug} />;
  }

  const [prisma, species] = await Promise.all([
    getPrismaForFarm(farmSlug),
    getFarmMode(farmSlug),
  ]);

  if (!prisma) {
    return (
      <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)]">
        <p className="text-sm" style={{ color: "var(--ft-poor)" }}>Farm not found.</p>
      </div>
    );
  }

  const [snapshot, pairingResult, allAnimals] = await Promise.all([
    getBreedingSnapshot(prisma, farmSlug, species),
    suggestPairings(prisma, farmSlug, species),
    scoped(prisma, species).animal.findMany({
      where: { status: "Active" },
      select: {
        id: true,
        animalId: true,
        sex: true,
        category: true,
        status: true,
        motherId: true,
        fatherId: true,
      },
    }),
  ]);

  const inbreedingRisks = detectInbreedingRisk(allAnimals);

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "var(--ft-text)" }}>Breeding AI</h1>
        <p className="text-sm mt-1" style={{ color: "var(--ft-subtle)" }}>
          AI-powered breeding analysis and inbreeding-safe pairing suggestions
        </p>
      </div>
      {pairingResult.reason === "NO_PEDIGREE_SEED" ? (
        <NoPedigreeEmptyState farmSlug={farmSlug} />
      ) : (
        <BreedingDashboard
          snapshot={snapshot}
          pairings={pairingResult.pairings}
          inbreedingRisks={inbreedingRisks}
          farmSlug={farmSlug}
        />
      )}
    </div>
  );
}
