import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { CAMPS } from "@/lib/dummy-data";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Count active animals per camp from Prisma
  const animalGroups = await prisma.animal.groupBy({
    by: ["currentCamp"],
    where: { status: "Active" },
    _count: { _all: true },
  });

  const countByCamp: Record<string, number> = {};
  for (const g of animalGroups) {
    countByCamp[g.currentCamp] = g._count._all;
  }

  const camps = CAMPS.map((camp) => ({
    ...camp,
    animal_count: countByCamp[camp.camp_id] ?? 0,
  }));

  return NextResponse.json(camps);
}
