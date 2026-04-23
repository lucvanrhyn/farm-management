import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { Camp } from "@/lib/types";
import dynamic from "next/dynamic";

const RainfallClient = dynamic(
  () => import("./RainfallClient"),
  { loading: () => <div className="h-48 animate-pulse bg-gray-100 rounded-lg" /> },
);

interface Props {
  farmSlug: string;
  camps: Camp[];
}

export default async function RainfallSection({ farmSlug, camps }: Props) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return null;

  const records = await prisma.rainfallRecord.findMany({
    orderBy: { date: "desc" },
  });

  // Compute monthly summary for chart
  const monthly = new Map<string, number>();
  for (const r of records) {
    const month = r.date.slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? 0) + r.rainfallMm);
  }
  const monthlySummary = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, totalMm]) => ({
      month,
      totalMm: Math.round(totalMm * 10) / 10,
    }));

  const campInfos = camps.map((c) => ({
    camp_id: c.camp_id,
    camp_name: c.camp_name,
  }));

  return (
    <RainfallClient
      farmSlug={farmSlug}
      records={records.map((r) => ({
        id: r.id,
        date: r.date,
        rainfallMm: r.rainfallMm,
        stationName: r.stationName,
        campId: r.campId,
      }))}
      monthlySummary={monthlySummary}
      camps={campInfos}
    />
  );
}
