// lib/server/inngest/functions.ts — Phase J1b / L Inngest functions.
//
// Two functions:
//   1. dailyAlertFanout — cron-triggered. Loads all tenant slugs and emits
//      one "alerts/evaluate.tenant" event per tenant. The Inngest scheduler
//      then runs the downstream function with retries + per-tenant isolation.
//   2. evaluateTenantAlerts — event-driven. Three durable steps per tenant:
//        evaluate  — query Tokyo for candidates (expensive)
//        persist   — dedup + upsert into Notification (idempotent via
//                    dedupKey + @@unique(type, dedupKey))
//        dispatch  — push + digest (idempotent via pushDispatchedAt /
//                    digestDispatchedAt stamped BEFORE each send)
//      Splitting (Phase L) means a transient SMTP / push outage only re-runs
//      the `dispatch` step; Inngest checkpoints the evaluate output so we
//      don't hammer Tokyo with the same queries on every retry.
//
// Step boundaries: Inngest persists each step.run return value as JSON, so
// Prisma class instances and Date values don't round-trip natively. We use
// explicit serializers in ./serializers so the types crossing each boundary
// are spelled out.
//
// Critical: we throw on missing FarmSettings (explicit failure per
// memory/silent-failure-pattern.md §4d). The old cron path at
// app/api/cron/notifications/route.ts silently continued past DB-missing
// tenants — we're replacing that with loud, observable failures.
//
// Inngest v4 API: createFunction({ id, triggers: [...], ... }, handler).
// Triggers live inside the options object; the handler receives { event, step }.

import type { PrismaClient } from "@prisma/client";
import { inngest } from "./client";
import { getAllFarmSlugs } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { evaluateAllAlerts, persistNotifications } from "@/lib/server/alerts";
import { dispatchChannels } from "@/lib/server/alerts/dispatch";
import {
  serializeCandidates,
  deserializeCandidates,
  serializeNotifications,
  deserializeNotifications,
  type SerializedAlertCandidate,
  type SerializedNotification,
} from "./serializers";

export const dailyAlertFanout = inngest.createFunction(
  {
    id: "daily-alert-fanout",
    triggers: [{ cron: "TZ=Africa/Johannesburg 0 5 * * *" }],
  },
  async ({ step }) => {
    const slugs = await step.run("load-tenants", () => getAllFarmSlugs());
    if (slugs.length === 0) return { tenantCount: 0 };
    await step.sendEvent(
      "fan-out",
      slugs.map((slug: string) => ({
        name: "alerts/evaluate.tenant",
        data: { slug },
      })),
    );
    return { tenantCount: slugs.length };
  },
);

export const evaluateTenantAlerts = inngest.createFunction(
  {
    id: "evaluate-tenant-alerts",
    retries: 3,
    concurrency: { limit: 5 },
    triggers: [{ event: "alerts/evaluate.tenant" }],
  },
  async ({ event, step }) => {
    const { slug } = event.data as { slug: string };

    // Step 1 — evaluate. Query Tokyo for this tenant's candidate alerts.
    // Expensive (fans out across ~13 generators). Return value is JSON-safe
    // via serializeCandidates so Inngest can checkpoint it.
    const candidates: SerializedAlertCandidate[] = await step.run(
      "evaluate",
      async () => {
        const prisma = (await getPrismaForFarm(slug)) as PrismaClient | null;
        if (!prisma) throw new Error(`No farm credentials for tenant "${slug}"`);
        const settings = await prisma.farmSettings.findFirst();
        if (!settings) {
          throw new Error(`FarmSettings missing on tenant "${slug}"`);
        }
        const raw = await evaluateAllAlerts(prisma, settings, slug);
        return serializeCandidates(raw);
      },
    );

    // Step 2 — persist. Dedup + upsert into Notification. Idempotent under
    // retry: `persistNotifications` keys every write on
    // (type, dedupKey) with the @@unique constraint catching races.
    const persisted: SerializedNotification[] = await step.run(
      "persist",
      async () => {
        const prisma = (await getPrismaForFarm(slug)) as PrismaClient | null;
        if (!prisma) throw new Error(`No farm credentials for tenant "${slug}"`);
        const hydrated = deserializeCandidates(candidates);
        const rows = await persistNotifications(prisma, hydrated);
        return serializeNotifications(rows);
      },
    );

    // Step 3 — dispatch. Push + digest. Idempotent per row: `dispatchChannels`
    // stamps pushDispatchedAt / digestDispatchedAt BEFORE each send, so a
    // retry after a transient network failure skips already-sent rows
    // ("at-most-once" delivery — research brief §B, Knock's leading-item
    // flush pattern).
    const dispatch = await step.run("dispatch", async () => {
      const prisma = (await getPrismaForFarm(slug)) as PrismaClient | null;
      if (!prisma) throw new Error(`No farm credentials for tenant "${slug}"`);
      const settings = await prisma.farmSettings.findFirst();
      if (!settings) {
        throw new Error(`FarmSettings missing on tenant "${slug}"`);
      }
      const rows = deserializeNotifications(persisted);
      return dispatchChannels(prisma, settings, rows, slug);
    });

    return {
      slug,
      candidateCount: candidates.length,
      persistedCount: persisted.length,
      dispatch,
    };
  },
);

export const ALL_FUNCTIONS = [dailyAlertFanout, evaluateTenantAlerts];
