import AdminNav from "@/components/admin/AdminNav";
import GameSubNav from "@/components/game/GameSubNav";
import { TierProvider } from "@/components/tier-provider";
import { getFarmCreds } from "@/lib/meta-db";
import type { FarmTier } from "@/lib/tier";

export default async function GameLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  let tier: FarmTier = "basic";
  try {
    const creds = await getFarmCreds(farmSlug);
    tier = (creds?.tier ?? "advanced") as FarmTier;
  } catch (err) {
    console.error(`[GameLayout] getFarmCreds failed for "${farmSlug}":`, err);
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

  return (
    <TierProvider tier={tier}>
      <div className="flex min-h-screen">
        <AdminNav tier={tier} />
        <main className="flex-1">
          <GameSubNav farmSlug={farmSlug} />
          {children}
        </main>
      </div>
    </TierProvider>
  );
}
