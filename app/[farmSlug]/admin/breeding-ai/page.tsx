export const dynamic = "force-dynamic";

import { getPrismaForFarm } from "@/lib/farm-prisma";
import {
  getBreedingSnapshot,
  suggestPairings,
  detectInbreedingRisk,
} from "@/lib/server/breeding-analytics";
import BreedingDashboard from "@/components/admin/BreedingDashboard";

export default async function BreedingAIPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
        <p className="text-sm" style={{ color: "#C0574C" }}>Farm not found.</p>
      </div>
    );
  }

  const [snapshot, pairings, allAnimals] = await Promise.all([
    getBreedingSnapshot(prisma, farmSlug),
    suggestPairings(prisma, farmSlug),
    prisma.animal.findMany({
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
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>Breeding AI</h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          AI-powered breeding analysis and inbreeding-safe pairing suggestions
        </p>
      </div>
      <BreedingDashboard
        snapshot={snapshot}
        pairings={pairings}
        inbreedingRisks={inbreedingRisks}
        farmSlug={farmSlug}
      />
    </div>
  );
}
