import { NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { getCachedNotifications } from "@/lib/server/cached";
import { emitServerTiming } from "@/lib/server/server-timing";

const CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=45";

export async function GET() {
  const t0 = performance.now();
  // Phase D (P6): one consolidated auth+resolve instead of
  // getServerSession → getPrismaWithAuth (two serial cold awaits).
  const ctx = await getFarmContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tAuth = performance.now();

  const { slug, session } = ctx;
  const userEmail = session.user?.email ?? "";

  const payload = await getCachedNotifications(slug, userEmail);
  const tCache = performance.now();

  const serverTiming = emitServerTiming({
    auth: tAuth - t0,
    cache: tCache - tAuth,
    total: tCache - t0,
  });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Server-Timing": serverTiming,
    },
  });
}
