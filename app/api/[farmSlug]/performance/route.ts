import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });

  const rows = await Promise.all(camps.map(async (camp) => {
    const [animalCount, latestCondition, latestCover] = await Promise.all([
      prisma.animal.count({ where: { currentCamp: camp.campId, status: "Active" } }),
      prisma.observation.findFirst({
        where: { campId: camp.campId, type: "camp_condition" },
        orderBy: { observedAt: "desc" },
      }),
      prisma.campCoverReading.findFirst({
        where: { campId: camp.campId },
        orderBy: { recordedAt: "desc" },
      }),
    ]);
    const density = camp.sizeHectares && camp.sizeHectares > 0
      ? (animalCount / camp.sizeHectares).toFixed(1)
      : null;
    const details = (latestCondition?.details as unknown) as Record<string, string> | null;
    return {
      campId: camp.campId,
      campName: camp.campName,
      sizeHectares: camp.sizeHectares,
      animalCount,
      stockingDensity: density,
      grazingQuality: details?.grazing ?? null,
      fenceStatus: details?.fence ?? null,
      lastInspection: latestCondition?.observedAt ? new Date(latestCondition.observedAt).toISOString().split("T")[0] : null,
      coverCategory: latestCover?.coverCategory ?? null,
      coverReadingDate: latestCover?.recordedAt ? new Date(latestCover.recordedAt).toISOString().split("T")[0] : null,
    };
  }));

  return NextResponse.json(rows);
}
