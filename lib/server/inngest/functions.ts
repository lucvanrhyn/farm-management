// lib/server/inngest/functions.ts — Phase J1b Inngest functions.
//
// Two functions:
//   1. dailyAlertFanout — cron-triggered. Loads all tenant slugs and emits
//      one "alerts/evaluate.tenant" event per tenant. The Inngest scheduler
//      then runs the downstream function with retries + per-tenant isolation.
//   2. evaluateTenantAlerts — event-driven. For each tenant: connect, load
//      settings, evaluate, persist, dispatch. Each step is durable so a
//      dispatch failure doesn't re-trigger evaluation.
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
    concurrency: { limit: 10 },
    triggers: [{ event: "alerts/evaluate.tenant" }],
  },
  async ({ event, step }) => {
    const { slug } = event.data as { slug: string };

    // We run the whole evaluation inside a single durable step. This trades
    // per-stage retry granularity for type safety (Inngest's step.run JSON-
    // serialises return values, stripping Prisma's class shape and converting
    // Date → string). The concurrency.limit still isolates per-tenant
    // failures, and retries: 3 reruns the whole step with exponential backoff.
    const result = await step.run(`evaluate-${slug}`, async () => {
      const prisma = (await getPrismaForFarm(slug)) as PrismaClient | null;
      if (!prisma) throw new Error(`No farm credentials for tenant "${slug}"`);
      const settings = await prisma.farmSettings.findFirst();
      if (!settings) throw new Error(`FarmSettings missing on tenant "${slug}"`);
      const candidates = await evaluateAllAlerts(prisma, settings, slug);
      const persisted = await persistNotifications(prisma, candidates);
      const dispatch = await dispatchChannels(prisma, settings, persisted, slug);
      return {
        slug,
        candidateCount: candidates.length,
        persistedCount: persisted.length,
        dispatch,
      };
    });

    return result;
  },
);

export const ALL_FUNCTIONS = [dailyAlertFanout, evaluateTenantAlerts];
