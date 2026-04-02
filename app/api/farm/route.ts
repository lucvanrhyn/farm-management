import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  try {
    const [settings, animalCount, campCount] = await Promise.all([
      prisma.farmSettings.findFirst(),
      prisma.animal.count({ where: { status: "Active" } }),
      prisma.camp.count(),
    ]);

    return NextResponse.json({
      farmName: settings?.farmName ?? "My Farm",
      breed: settings?.breed ?? "Mixed",
      animalCount,
      campCount,
    });
  } catch (err) {
    const e = err as Record<string, unknown>;
    console.error("[GET /api/farm] query failed:", {
      message: e?.message,
      code: e?.code,
      meta: e?.meta,
      name: e?.name,
    });
    return NextResponse.json(
      { error: "Failed to load farm data" },
      { status: 500 },
    );
  }
}
