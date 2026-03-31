import LeagueTable from "@/components/admin/LeagueTable";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getCampLeagueData } from "@/lib/server/league-analytics";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found</p>;

  const settings = await prisma.farmSettings.findFirst();
  const campGrazingWarningDays = settings?.campGrazingWarningDays ?? 7;

  const rows = await getCampLeagueData(prisma);

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#1C1815]">Camp League</h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          {rows.length} camps · ranked by ADG — click any column to re-sort
        </p>
      </div>
      <LeagueTable rows={rows} farmSlug={farmSlug} campGrazingWarningDays={campGrazingWarningDays} />
    </div>
  );
}
