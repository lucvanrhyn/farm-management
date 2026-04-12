import { redirect } from "next/navigation";
import AdminNav from "@/components/admin/AdminNav";
import { TierProvider } from "@/components/tier-provider";
import { getFarmCreds } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getSession } from "@/lib/auth";
import { getUserRoleForFarm } from "@/lib/auth";
import type { FarmTier } from "@/lib/tier";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  // Guard: require authenticated ADMIN role for this specific farm
  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (getUserRoleForFarm(session, farmSlug) !== "ADMIN") {
    redirect(`/${farmSlug}/home`);
  }

  let tier: FarmTier = "basic"; // fail-safe: minimum privilege on error
  let enabledSpecies: string[] | undefined;

  const [credsResult, speciesResult] = await Promise.allSettled([
    getFarmCreds(farmSlug),
    getPrismaForFarm(farmSlug).then((p) => p?.farmSpeciesSettings.findMany() ?? []),
  ]);

  if (credsResult.status === "rejected") {
    console.error(`[AdminLayout] getFarmCreds failed for "${farmSlug}":`, credsResult.reason);
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <div className="text-center max-w-md px-4">
          <h1 className="text-lg font-bold mb-2" style={{ color: "#1C1815" }}>
            Connection Error
          </h1>
          <p className="text-sm" style={{ color: "#9C8E7A" }}>
            Could not connect to the database. Please try refreshing the page or contact support if the issue persists.
          </p>
        </div>
      </div>
    );
  }

  tier = (credsResult.value?.tier ?? "basic") as FarmTier;

  if (speciesResult.status === "fulfilled" && speciesResult.value) {
    enabledSpecies = speciesResult.value
      .filter((r) => r.enabled)
      .map((r) => r.species);
  }
  // fail-open: if species fetch fails, enabledSpecies stays undefined → AdminNav shows all

  return (
    <TierProvider tier={tier}>
      <div className="flex min-h-screen">
        <AdminNav tier={tier} enabledSpecies={enabledSpecies} />
        <main className="flex-1">{children}</main>
      </div>
    </TierProvider>
  );
}
