import type { PrismaClient } from "@prisma/client";
import { getDashboardAlerts } from "@/lib/server/dashboard-alerts";
import type { AlertThresholds } from "@/lib/server/dashboard-alerts";
import { sendPushToFarm } from "@/lib/server/push-sender";

const DEFAULT_THRESHOLDS: AlertThresholds = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  staleCampInspectionHours: 48,
};

/**
 * Generates (or refreshes) notification records from the current alert state.
 * - Deduplicates by `type`: only creates a new record if none exists in the last 24h
 * - Marks expired notifications (expiresAt < now) as read
 * - Returns the count of new notifications created
 */
export async function generateNotifications(
  prisma: PrismaClient,
  farmSlug: string,
): Promise<number> {
  // Load farm-specific thresholds
  const settings = await prisma.farmSettings.findUnique({ where: { id: "singleton" } });
  const thresholds: AlertThresholds = {
    adgPoorDoerThreshold: settings?.adgPoorDoerThreshold ?? DEFAULT_THRESHOLDS.adgPoorDoerThreshold,
    calvingAlertDays: settings?.calvingAlertDays ?? DEFAULT_THRESHOLDS.calvingAlertDays,
    daysOpenLimit: settings?.daysOpenLimit ?? DEFAULT_THRESHOLDS.daysOpenLimit,
    campGrazingWarningDays: settings?.campGrazingWarningDays ?? DEFAULT_THRESHOLDS.campGrazingWarningDays,
    staleCampInspectionHours: settings?.alertThresholdHours ?? DEFAULT_THRESHOLDS.staleCampInspectionHours,
  };

  const alerts = await getDashboardAlerts(prisma, farmSlug, thresholds);
  const allAlerts = [...alerts.red, ...alerts.amber];

  if (allAlerts.length === 0) return 0;

  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Find types already notified in the last 24h to avoid spam
  const existing = await prisma.notification.findMany({
    where: { createdAt: { gte: windowStart } },
    select: { type: true },
  });
  const existingTypes = new Set(existing.map((n) => n.type));

  let created = 0;
  const newRedAlerts: { message: string; href: string }[] = [];

  for (const alert of allAlerts) {
    if (existingTypes.has(alert.id)) continue;

    await prisma.notification.create({
      data: {
        type: alert.id,
        severity: alert.severity,
        message: alert.message,
        href: alert.href,
        expiresAt,
      },
    });
    created++;

    if (alert.severity === "red") {
      newRedAlerts.push({ message: alert.message, href: alert.href });
    }
  }

  // Send push notification for new RED alerts (batched into one push)
  if (newRedAlerts.length > 0) {
    const title = newRedAlerts.length === 1 ? "FarmTrack Alert" : `FarmTrack — ${newRedAlerts.length} alerts`;
    const body = newRedAlerts.map((a) => a.message).join(" · ");
    try {
      await sendPushToFarm(prisma, { title, body, href: newRedAlerts[0].href });
    } catch {
      // Push failures are non-fatal — DB notifications are the source of truth
    }
  }

  // Mark expired notifications as read (housekeeping)
  await prisma.notification.updateMany({
    where: { expiresAt: { lt: now }, isRead: false },
    data: { isRead: true },
  });

  return created;
}
