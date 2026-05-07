import { NextResponse } from "next/server";
import { tenantRead } from "@/lib/server/route";
import { getCachedCampConditions } from "@/lib/server/cached";
import { timeAsync } from "@/lib/server/server-timing";

export const GET = tenantRead({
  handle: async (ctx) => {
    // Throws on DB failure → adapter emits the typed DB_QUERY_FAILED envelope
    // (replaces the per-route try/catch the old hand-rolled handler carried).
    const conditions = await timeAsync("query", () =>
      getCachedCampConditions(ctx.slug),
    );
    const result: Record<string, unknown> = {};
    for (const [campId, status] of conditions.entries()) {
      result[campId] = status;
    }
    return NextResponse.json(result);
  },
});
