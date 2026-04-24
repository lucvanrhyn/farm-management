import { FarmModeProvider } from "@/lib/farm-mode";
import { getCachedFarmSpeciesSettings } from "@/lib/server/cached";
import AppShell from "@/components/AppShell";

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
    const { enabledSpecies: cached } = await getCachedFarmSpeciesSettings(farmSlug);
    enabledSpecies = cached;
  } catch {
    // Fail-open: default to cattle-only if species settings unavailable
  }

  // AppShell wraps in SessionProvider + SWRegistrar + ReportWebVitals.
  // Added as part of the P5 perf work: the root layout no longer ships
  // the authenticated shell to unauthenticated routes. All farmSlug
  // pages need the session context (useSession in logger).
  return (
    <AppShell>
      <FarmModeProvider farmSlug={farmSlug} enabledSpecies={enabledSpecies}>
        {children}
      </FarmModeProvider>
    </AppShell>
  );
}
