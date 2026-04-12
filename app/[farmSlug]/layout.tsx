import { getPrismaForFarm } from "@/lib/farm-prisma";
import { FarmModeProvider } from "@/lib/farm-mode";

export default async function FarmSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  let enabledSpecies: string[] = ["cattle"];

  try {
    const prisma = await getPrismaForFarm(farmSlug);
    if (prisma) {
      const settings = await prisma.farmSpeciesSettings.findMany();
      enabledSpecies = settings
        .filter((s) => s.enabled)
        .map((s) => s.species);
      // Ensure cattle is always present
      if (!enabledSpecies.includes("cattle")) {
        enabledSpecies.unshift("cattle");
      }
    }
  } catch {
    // Fail-open: default to cattle-only if species settings unavailable
  }

  return (
    <FarmModeProvider farmSlug={farmSlug} enabledSpecies={enabledSpecies}>
      {children}
    </FarmModeProvider>
  );
}
