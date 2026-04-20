import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { FarmModeProvider } from "@/lib/farm-mode";
import type { SessionFarm } from "@/types/next-auth";

export default async function FarmSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  // Defense-in-depth: proxy.ts already gates this subtree, but the layout must
  // not trust a routing layer it doesn't own. Verify session + membership here
  // so that any future matcher regression, edge-runtime bypass, or direct RSC
  // invocation still can't read another tenant's data.
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const farms = session.user?.farms as SessionFarm[] | undefined;
  if (!farms?.some((f) => f.slug === farmSlug)) redirect("/farms");

  let enabledSpecies: string[] = ["cattle"];

  try {
    const prisma = await getPrismaForFarm(farmSlug);
    if (prisma) {
      const settings = await prisma.farmSpeciesSettings.findMany();
      enabledSpecies = settings
        .filter((s) => s.enabled)
        .map((s) => s.species);
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
