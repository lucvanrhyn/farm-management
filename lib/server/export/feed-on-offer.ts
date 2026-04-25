// lib/server/export/feed-on-offer.ts
// Feed on Offer (FOO) exporter (CSV/PDF) — per-camp dry-matter capacity
// snapshot keyed off the latest cover reading.

import { getFarmFeedOnOfferPayload } from "@/lib/server/feed-on-offer";
import { feedOnOfferToCSV, type FeedOnOfferRow } from "@/lib/server/export-csv";
import type { ExportArtifact, ExportContext } from "./types";
import { buildPdf, csvFilename, pdfFilename } from "./pdf";

export async function exportFeedOnOffer(ctx: ExportContext): Promise<ExportArtifact> {
  const now = new Date();
  const payload = await getFarmFeedOnOfferPayload(ctx.prisma, now);
  const rows: FeedOnOfferRow[] = payload.byCamp.map((c) => ({
    campId: c.campId,
    campName: c.campName,
    sizeHectares: c.sizeHectares,
    kgDmPerHa: c.feedOnOffer.kgDmPerHa,
    status: c.feedOnOffer.status,
    effectiveFeedOnOfferKg: c.feedOnOffer.effectiveFeedOnOfferKg,
    capacityLsuDays: c.feedOnOffer.capacityLsuDays,
    lastRecordedAt: c.latestReading?.recordedAt ?? null,
    daysSinceReading: c.feedOnOffer.daysSinceReading,
    trendSlope: c.trendSlope,
  }));

  if (ctx.format === "csv") {
    return {
      contentType: "text/csv",
      filename: csvFilename("feed-on-offer"),
      body: feedOnOfferToCSV(rows),
    };
  }

  const pdfBuf = await buildPdf(
    "Feed on Offer Summary",
    ["Camp", "Name", "Ha", "kg DM/ha", "Status", "Effective (kg)", "Capacity (LSU-days)", "Last Reading", "Days Since", "Trend/mo"],
    rows.map((r) => [
      r.campId,
      r.campName,
      r.sizeHectares,
      r.kgDmPerHa,
      r.status,
      r.effectiveFeedOnOfferKg != null ? Math.round(r.effectiveFeedOnOfferKg) : null,
      r.capacityLsuDays != null ? Math.round(r.capacityLsuDays) : null,
      r.lastRecordedAt,
      r.daysSinceReading,
      r.trendSlope.toFixed(1),
    ]),
  );
  return {
    contentType: "application/pdf",
    filename: pdfFilename("feed-on-offer"),
    body: pdfBuf,
  };
}
