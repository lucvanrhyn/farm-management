import { NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { getCachedFarmSummary } from "@/lib/server/cached";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";
import { logger } from "@/lib/logger";

export async function GET() {
  return withServerTiming(async () => {
    // Phase D (P6): `getFarmContext` reads proxy's signed header triplet
    // via next/headers when no `req` is passed, so a legacy zero-arg
    // handler gets the same fast-path. Falls back to getServerSession
    // transparently when the triplet is missing.
    const ctx = await timeAsync("session", () => getFarmContext());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const summary = await timeAsync("query", () => getCachedFarmSummary(ctx.slug));
      return NextResponse.json(summary);
    } catch (err) {
      const e = err as Record<string, unknown>;
      logger.error('[GET /api/farm] query failed', {
        message: e?.message,
        code: e?.code,
      });
      return NextResponse.json({ error: "Failed to load farm data" }, { status: 500 });
    }
  });
}
