import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { getCachedCampConditions } from "@/lib/server/cached";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";

export async function GET() {
  return withServerTiming(async () => {
    const session = await timeAsync("session", () => getServerSession(authOptions));
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getPrismaWithAuth(session);
    if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });

    try {
      const conditions = await timeAsync("query", () => getCachedCampConditions(db.slug));
      const result: Record<string, unknown> = {};
      for (const [campId, status] of conditions.entries()) {
        result[campId] = status;
      }
      return NextResponse.json(result);
    } catch (err) {
      console.error("[camps/status] DB error:", err);
      return NextResponse.json({ error: "Failed to load camp conditions" }, { status: 500 });
    }
  });
}
