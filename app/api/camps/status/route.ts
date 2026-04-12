import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getLatestCampConditions } from "@/lib/server/camp-status";
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
    const conditions = await getLatestCampConditions(prisma);
    // Convert Map to plain object for JSON serialisation
    const result: Record<string, unknown> = {};
    for (const [campId, status] of conditions.entries()) {
      result[campId] = status;
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[camps/status] DB error:", err);
    return NextResponse.json({ error: "Failed to load camp conditions" }, { status: 500 });
  }
}
