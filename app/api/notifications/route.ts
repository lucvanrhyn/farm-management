import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { getCachedNotifications } from "@/lib/server/cached";
import { emitServerTiming } from "@/lib/server/server-timing";

const CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=45";

export async function GET() {
  const t0 = performance.now();
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tAuth = performance.now();

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { slug } = db;
  const userEmail = session.user?.email ?? "";
  const tDb = performance.now();

  const payload = await getCachedNotifications(slug, userEmail);
  const tCache = performance.now();

  const serverTiming = emitServerTiming({
    auth: tAuth - t0,
    resolve: tDb - tAuth,
    cache: tCache - tDb,
    total: tCache - t0,
  });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Server-Timing": serverTiming,
    },
  });
}
