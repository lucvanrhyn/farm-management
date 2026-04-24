import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { getCachedCampConditions } from "@/lib/server/cached";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";

export async function GET(req: NextRequest) {
  return withServerTiming(async () => {
    const ctx = await timeAsync("session", () => getFarmContext(req));
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const conditions = await timeAsync("query", () => getCachedCampConditions(ctx.slug));
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
