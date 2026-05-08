/**
 * Wave F (#163) — `/api/notifications` GET migrated onto `tenantRead`.
 *
 * Domain op (`listNotifications`) wraps `getCachedNotifications` from
 * `lib/server/cached.ts`. The adapter resolves the farm context (auth +
 * tenant-scoped Prisma); the inner `handle` keeps a hand-rolled
 * `performance.now()` instrumentation so the existing `Server-Timing`
 * contract (auth/cache/total spans) and `Cache-Control` header remain
 * byte-identical to the pre-Wave-F response.
 *
 * The adapter does NOT strip user-set headers — see
 * `lib/server/route/tenant-read.ts` and the
 * `__tests__/api/notifications-cache-control.test.ts` invariant.
 */
import { NextResponse } from "next/server";

import { tenantRead } from "@/lib/server/route";
import { listNotifications } from "@/lib/domain/notifications";
import { emitServerTiming } from "@/lib/server/server-timing";

const CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=45";

export const GET = tenantRead({
  handle: async (ctx) => {
    const t0 = performance.now();
    const { slug, session } = ctx;
    const userEmail = session.user?.email ?? "";
    const tAuth = performance.now();

    const payload = await listNotifications(slug, userEmail);
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
  },
});
