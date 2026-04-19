// lib/server/alerts/digest-email.ts — J4b daily digest email.
//
// Runs once per tenant from the Inngest dispatcher step. Collects unread
// notifications from the last 24h, groups by category, renders the
// "alert-digest" template, sends via the generalised sendEmail helper.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { DigestGroup } from "@/lib/server/send-email";
import { sendEmail } from "@/lib/server/send-email";

const LOOKBACK_HOURS = 24;

interface DigestResult {
  sent: boolean;
  reason?: string;
  to?: string;
  groupCount?: number;
  alertCount?: number;
}

/** Map any alert type string → user-facing category label. */
function categoryFromType(type: string): DigestGroup["category"] {
  if (type.startsWith("LAMBING") || type.startsWith("FAWNING") || type.startsWith("CALVING") || type.startsWith("LEGACY_CALVING")) return "Reproduction";
  if (type.startsWith("NO_WEIGHING") || type.startsWith("SHEARING") || type.startsWith("CRUTCHING") || type.startsWith("LEGACY_POOR_DOER")) return "Performance";
  if (type.startsWith("COVER_READING") || type.startsWith("LSU_OVERSTOCK") || type.startsWith("LEGACY_VELD") || type.startsWith("LEGACY_FEED_ON_OFFER") || type.startsWith("LEGACY_ROTATION") || type.startsWith("LEGACY_POOR_GRAZING")) return "Veld & Grazing";
  if (type.startsWith("COG_")) return "Finance";
  if (type.startsWith("TAX_DEADLINE") || type.startsWith("WATER_SERVICE") || type.startsWith("LEGACY_IN_WITHDRAWAL")) return "Compliance";
  if (type.startsWith("RAINFALL") || type.startsWith("SPI_DROUGHT") || type.startsWith("LEGACY_DROUGHT")) return "Weather";
  if (type.startsWith("PREDATOR_SPIKE") || type.startsWith("LEGACY_SHEEP_PREDATION") || type.startsWith("LEGACY_GAME_PREDATION")) return "Predator";
  return "Other";
}

async function findAdminEmail(prisma: PrismaClient): Promise<string | null> {
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, select: { email: true } });
  if (admin?.email) return admin.email;
  // Fall back to any user if no admin role is assigned — better than silently
  // not delivering the digest.
  const any = await prisma.user.findFirst({ select: { email: true } });
  return any?.email ?? null;
}

export async function sendDailyDigest(
  prisma: PrismaClient,
  settings: FarmSettings,
  farmSlug: string,
): Promise<DigestResult> {
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const rows = await prisma.notification.findMany({
    where: { createdAt: { gte: cutoff }, isRead: false },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return { sent: false, reason: "no-alerts" };

  // Group by category.
  const grouped = new Map<string, DigestGroup>();
  for (const n of rows) {
    const cat = categoryFromType(n.type);
    let group = grouped.get(cat);
    if (!group) {
      group = { category: cat, items: [] };
      grouped.set(cat, group);
    }
    group.items.push({ message: n.message, href: n.href, severity: n.severity });
  }
  const groups = Array.from(grouped.values());

  const to = await findAdminEmail(prisma);
  if (!to) return { sent: false, reason: "no-admin-email" };

  const result = await sendEmail({
    to,
    template: "alert-digest",
    data: {
      farmSlug,
      farmName: settings.farmName,
      groups,
    },
  });

  return {
    sent: result.sent,
    reason: result.skipped ?? result.error,
    to,
    groupCount: groups.length,
    alertCount: rows.length,
  };
}
