import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { getCachedFarmSummary } from "@/lib/server/cached";
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
      const summary = await timeAsync("query", () => getCachedFarmSummary(db.slug));
      return NextResponse.json(summary);
    } catch (err) {
      const e = err as Record<string, unknown>;
      console.error("[GET /api/farm] query failed:", {
        message: e?.message,
        code: e?.code,
      });
      return NextResponse.json({ error: "Failed to load farm data" }, { status: 500 });
    }
  });
}
