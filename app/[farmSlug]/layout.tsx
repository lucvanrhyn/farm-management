import { FarmModeProvider } from "@/lib/farm-mode";
import { getCachedFarmSpeciesSettings } from "@/lib/server/cached";
import AppShell from "@/components/AppShell";
import { OfflineProvider } from "@/components/logger/OfflineProvider";

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
  //
  // OfflineProvider was previously mounted only in
  // `app/[farmSlug]/logger/layout.tsx`, which made `useOffline()` throw
  // "useOffline must be used within OfflineProvider" anywhere in the
  // admin tree that consumed the context — most visibly the Move-Mob
  // control on /<farmSlug>/admin/map (production-triage 2026-05-03,
  // P0.3). Hoisting it here so admin + logger both share one provider
  // instance is multi-tenant safe — the provider keys all IndexedDB
  // operations off `pathname.split('/')[1]`, which equals farmSlug for
  // every nested route — and prevents the double-mount race that would
  // otherwise occur if both layouts mounted their own.
  return (
    <AppShell>
      <FarmModeProvider farmSlug={farmSlug} enabledSpecies={enabledSpecies}>
        <OfflineProvider>{children}</OfflineProvider>
      </FarmModeProvider>
    </AppShell>
  );
}
