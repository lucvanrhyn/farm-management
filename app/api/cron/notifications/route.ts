import { NextRequest, NextResponse } from "next/server";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getAllFarmSlugs } from "@/lib/meta-db";
import { generateNotifications } from "@/lib/server/notification-generator";

/**
 * POST /api/cron/notifications
 * Called daily by Vercel Cron at 5am UTC (7am SAST).
 * Protected by CRON_SECRET header to prevent unauthorized triggering.
 */
export async function POST(req: NextRequest) {
  // Fail closed: if CRON_SECRET is not configured the endpoint rejects all requests.
  // Never allow the open-to-all path that existed when the guard was `if (secret)`.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slugs = await getAllFarmSlugs();
  const results: { slug: string; created: number; error?: string }[] = [];

  for (const slug of slugs) {
    try {
      const prisma = await getPrismaForFarm(slug);
      if (!prisma) {
        results.push({ slug, created: 0, error: "DB not found" });
        continue;
      }
      const created = await generateNotifications(prisma, slug);
      results.push({ slug, created });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ slug, created: 0, error: message });
    }
  }

  return NextResponse.json({ ok: true, results });
}
