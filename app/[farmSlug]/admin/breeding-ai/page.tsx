export const dynamic = "force-dynamic";

import Link from "next/link";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import {
  getBreedingSnapshot,
  suggestPairings,
  detectInbreedingRisk,
} from "@/lib/server/breeding-analytics";
import BreedingDashboard from "@/components/admin/BreedingDashboard";
import { getFarmCreds } from "@/lib/meta-db";
import UpgradePrompt from "@/components/admin/UpgradePrompt";

function NoPedigreeEmptyState({ farmSlug }: { farmSlug: string }) {
  return (
    <div
      className="mt-6 flex flex-col items-center gap-5 rounded-2xl px-8 py-12 text-center"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(196,144,48,0.2)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      {/* Inline pedigree-tree glyph, pure CSS — no new asset */}
      <div
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full"
        style={{
          background: "rgba(196,144,48,0.10)",
          border: "1px solid rgba(196,144,48,0.28)",
          color: "#8B6914",
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="2.5" />
          <circle cx="5" cy="18" r="2.5" />
          <circle cx="19" cy="18" r="2.5" />
          <path d="M12 7.5v4" />
          <path d="M7 15.5 10.5 12h3L17 15.5" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold" style={{ color: "#1C1815" }}>
        Pedigree data needed
      </h2>
      <p className="text-sm max-w-md" style={{ color: "#6A4E30", lineHeight: 1.55 }}>
        Breeding suggestions need pedigree data to avoid in-breeding. Import
        your herd book via our AI Import Wizard to unlock bull-to-cow pairings,
        COI analysis and inbreeding risk detection.
      </p>
      <Link
        href={`/${farmSlug}/admin/import?template=pedigree`}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
        style={{
          background: "#8B6914",
          color: "#FAFAF8",
          boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
        }}
      >
        Import pedigree data
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

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

  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
        <p className="text-sm" style={{ color: "#C0574C" }}>Farm not found.</p>
      </div>
    );
  }

  const [snapshot, pairingResult, allAnimals] = await Promise.all([
    getBreedingSnapshot(prisma, farmSlug),
    suggestPairings(prisma, farmSlug),
    prisma.animal.findMany({
      where: { status: "Active", species: "cattle" },
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
