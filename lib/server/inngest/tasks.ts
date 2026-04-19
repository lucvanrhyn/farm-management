// lib/server/inngest/tasks.ts — Phase K Wave 2B: recurring-task engine.
//
// Two cron-triggered Inngest functions:
//
//   1. regenerateTaskOccurrences (02:00 Africa/Johannesburg, nightly)
//      Walks every tenant, expands each recurring Task via lib/tasks/recurrence,
//      and upserts TaskOccurrence rows up to 90 days out. Future "pending"
//      occurrences beyond the horizon are purged (rules may shorten).
//
//   2. dispatchTaskReminders (every 5 minutes)
//      Walks every tenant, finds TaskOccurrence rows whose reminderAt is due
//      and reminderDispatchedAt is null, stamps them (mark-before-send per
//      Phase J §B) and writes a TASK_REMINDER Notification row. The Phase J
//      dispatcher picks these up on its next tick and handles channels +
//      quiet-hours + digest.
//
// Pattern reuse (see inline citations):
//   - Fan-out: mirrors dailyAlertFanout in lib/server/inngest/functions.ts:26-43
//     (step.run("load-tenants") → step.sendEvent fan-out).
//   - Mark-before-send idempotency: lib/server/alerts/dispatch.ts:117-121.
//   - P2002 retry on concurrent upsert: lib/server/alerts/dedup.ts:213-253.
//   - Tenant Prisma helper: getPrismaForFarm from lib/farm-prisma.ts.
//
// Guardrails (Phase K Wave 2B brief):
//   - No module-load-time env reads. Inngest's constructor is env-safe; see
//     memory/workstream-j lesson "Inngest constructor is env-independent".
//   - We import the shared inngest client — we do NOT instantiate a new one.
//   - No touching proxy.ts matcher; /api/inngest is already allowlisted.

import type { Prisma, PrismaClient } from "@prisma/client";
import { inngest } from "./client";
import { getAllFarmSlugs } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
// TODO(wave-2A): this module is created by Wave 2A (lib/tasks/recurrence.ts).
// If 2A has not landed when 2B typechecks, this import will fail — retry once
// Wave 2A's commit is on the branch. Signature contract:
//   expandRule(rule: string, fromDate: Date, horizonDays?: number, ctx?: ExpandContext) => Date[]
import { expandRule, type ExpandContext } from "@/lib/tasks/recurrence";

const HORIZON_DAYS = 90;
const OBSERVATION_LOOKBACK_DAYS = 365;
const TENANT_EVENT_REGENERATE = "tasks/regenerate.tenant";
const TENANT_EVENT_REMINDERS = "tasks/reminders.tenant";

// ── Fan-out functions (cron triggers) ───────────────────────────────────────

/**
 * Nightly regeneration fan-out. Loads every tenant slug from meta-db and
 * dispatches one Inngest event per tenant. Mirrors dailyAlertFanout in
 * lib/server/inngest/functions.ts:26-43.
 */
export const regenerateTaskOccurrences = inngest.createFunction(
  {
    id: "regenerate-task-occurrences",
    triggers: [{ cron: "TZ=Africa/Johannesburg 0 2 * * *" }],
  },
  async ({ step }) => {
    const slugs = await step.run("load-tenants", () => getAllFarmSlugs());
    if (slugs.length === 0) return { tenantCount: 0 };
    await step.sendEvent(
      "fan-out",
      slugs.map((slug: string) => ({
        name: TENANT_EVENT_REGENERATE,
        data: { slug },
      })),
    );
    return { tenantCount: slugs.length };
  },
);

/**
 * Every-5-minutes reminder fan-out. Same fan-out pattern — one event per
 * tenant so a single slow tenant doesn't block the others.
 */
export const dispatchTaskReminders = inngest.createFunction(
  {
    id: "dispatch-task-reminders",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const slugs = await step.run("load-tenants", () => getAllFarmSlugs());
    if (slugs.length === 0) return { tenantCount: 0 };
    await step.sendEvent(
      "fan-out",
      slugs.map((slug: string) => ({
        name: TENANT_EVENT_REMINDERS,
        data: { slug },
      })),
    );
    return { tenantCount: slugs.length };
  },
);

// ── Per-tenant worker functions (event-driven) ──────────────────────────────

export const regenerateTaskOccurrencesForTenant = inngest.createFunction(
  {
    id: "regenerate-task-occurrences-tenant",
    retries: 3,
    concurrency: { limit: 10 },
    triggers: [{ event: TENANT_EVENT_REGENERATE }],
  },
  async ({ event, step }) => {
    const { slug } = event.data as { slug: string };

    return step.run(`regenerate-${slug}`, async () => {
      const prisma = (await getPrismaForFarm(slug)) as PrismaClient | null;
      if (!prisma) {
        // Loud failure per memory/silent-failure-pattern.md §4d.
        throw new Error(`No farm credentials for tenant "${slug}"`);
      }
      return regenerateForTenant(prisma);
    });
  },
);

export const dispatchTaskRemindersForTenant = inngest.createFunction(
  {
    id: "dispatch-task-reminders-tenant",
    retries: 3,
    concurrency: { limit: 10 },
    triggers: [{ event: TENANT_EVENT_REMINDERS }],
  },
  async ({ event, step }) => {
    const { slug } = event.data as { slug: string };

    return step.run(`dispatch-reminders-${slug}`, async () => {
      const prisma = (await getPrismaForFarm(slug)) as PrismaClient | null;
      if (!prisma) {
        throw new Error(`No farm credentials for tenant "${slug}"`);
      }
      return dispatchRemindersForTenant(prisma);
    });
  },
);

// ── Core logic (testable, Prisma-mockable) ──────────────────────────────────

/**
 * P2002 guard copied from lib/server/alerts/dedup.ts:28-34. Keeps the module
 * free of runtime Prisma imports so jsdom/node fixtures stay cheap.
 */
function isP2002(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

export interface RegenerateResult {
  taskCount: number;
  occurrencesCreated: number;
  occurrencesSkipped: number;
  horizonPurged: number;
}

/**
 * For one tenant: expand every Task with a recurrenceRule out to HORIZON_DAYS,
 * upsert TaskOccurrence rows (skipping on P2002 — occurrences are append-only
 * keyed on (taskId, occurrenceAt)), and purge future pending occurrences past
 * the horizon so a shortened rule doesn't leak stale rows.
 */
export async function regenerateForTenant(
  prisma: PrismaClient,
): Promise<RegenerateResult> {
  const now = new Date();
  const horizonCutoff = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const tasks = await prisma.task.findMany({
    where: { recurrenceRule: { not: null } },
  });

  const result: RegenerateResult = {
    taskCount: tasks.length,
    occurrencesCreated: 0,
    occurrencesSkipped: 0,
    horizonPurged: 0,
  };

  for (const task of tasks) {
    if (!task.recurrenceRule) continue;

    const ctx = await buildExpandContext(prisma, task);
    const dates = expandRule(task.recurrenceRule, now, HORIZON_DAYS, ctx);

    for (const occurrenceAt of dates) {
      const reminderAt =
        task.reminderOffset != null
          ? new Date(occurrenceAt.getTime() - task.reminderOffset * 60_000)
          : null;

      try {
        await prisma.taskOccurrence.create({
          data: {
            taskId: task.id,
            occurrenceAt,
            reminderAt,
            status: "pending",
          },
        });
        result.occurrencesCreated++;
      } catch (err) {
        if (!isP2002(err)) throw err;
        // Duplicate (taskId, occurrenceAt) — occurrence already materialised
        // on a prior run. This is the happy path for re-runs; skip silently.
        // We intentionally do NOT re-fetch-merge like dedup.ts does: task
        // occurrences are append-only until completion, so the existing row
        // is already correct.
        result.occurrencesSkipped++;
      }
    }
  }

  // Horizon purge. Rule shortening is rare but non-zero; purging beyond the
  // current horizon for completed/pending rules keeps stale occurrences from
  // surviving a rule edit. Only pending rows are purged — completed/skipped
  // rows are historical record.
  if (tasks.length > 0) {
    const purged = await prisma.taskOccurrence.deleteMany({
      where: {
        taskId: { in: tasks.map((t) => t.id) },
        occurrenceAt: { gt: horizonCutoff },
        status: "pending",
      },
    });
    result.horizonPurged = purged.count;
  }

  return result;
}

/**
 * Builds the ExpandContext for a single task by pulling recent observations
 * and season windows. `after:<obsType>+Nd` / `before:<obsType>-Nd` shortcuts
 * need the animal's last N observations of the matching type; `season:<key>`
 * shortcuts read windows from FarmSettings. We over-fetch (365d) so the
 * recurrence engine can reason about multi-year cadences.
 */
async function buildExpandContext(
  prisma: PrismaClient,
  task: { id: string; animalId: string | null },
): Promise<ExpandContext> {
  const events: ExpandContext["events"] = [];
  if (task.animalId) {
    const since = new Date(Date.now() - OBSERVATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const observations = await prisma.observation.findMany({
      where: {
        animalId: task.animalId,
        observedAt: { gte: since },
      },
      select: { type: true, observedAt: true },
      orderBy: { observedAt: "desc" },
    });
    for (const obs of observations) {
      events.push({ type: obs.type, at: obs.observedAt });
    }
  }

  // Season windows live on FarmSettings.breedingSeasonStart/End (stored as
  // ISO date strings, e.g. "2026-03-01"). If unset we hand back an empty map
  // — the recurrence engine tolerates missing season keys by returning no
  // dates for `season:<key>` rules.
  const settings = await prisma.farmSettings.findFirst();
  const seasonWindows: Record<string, Array<{ start: Date; end: Date }>> = {};
  if (settings?.breedingSeasonStart && settings?.breedingSeasonEnd) {
    const start = new Date(settings.breedingSeasonStart);
    const end = new Date(settings.breedingSeasonEnd);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      seasonWindows.breeding = [{ start, end }];
    }
  }

  return { events, seasonWindows };
}

export interface DispatchResult {
  ready: number;
  dispatched: number;
  raceSkipped: number;
}

/**
 * For one tenant: find TaskOccurrence rows whose reminderAt has passed and
 * reminderDispatchedAt is null, stamp them (mark-before-send per Phase J §B),
 * and write a TASK_REMINDER Notification row per stamped occurrence. The
 * Phase J dispatcher (dailyAlertFanout) will pick them up on its next tick.
 *
 * Idempotency model (matches lib/server/alerts/dispatch.ts:117-121):
 *   1. Read candidate rows (reminderAt ≤ now, reminderDispatchedAt = null).
 *   2. updateMany WHERE id IN (...) AND reminderDispatchedAt = null to stamp.
 *   3. Re-read the NOW-STAMPED rows (filter by dispatchedAt ≥ our stamp) and
 *      write one Notification per row. Any row that was claimed by a racing
 *      run between step 1 and step 2 will not be stamped by us — we skip it.
 *   4. If the Notification insert fails the stamp stays set (at-most-once).
 */
export async function dispatchRemindersForTenant(
  prisma: PrismaClient,
): Promise<DispatchResult> {
  const now = new Date();

  const ready = await prisma.taskOccurrence.findMany({
    where: {
      reminderAt: { lte: now, not: null },
      reminderDispatchedAt: null,
    },
    include: { task: true },
  });

  if (ready.length === 0) {
    return { ready: 0, dispatched: 0, raceSkipped: 0 };
  }

  // Mark-before-send. Only rows whose reminderDispatchedAt is still null will
  // be stamped; a concurrent worker's stamp blocks ours and we skip that row.
  const stamp = new Date();
  const stamped = await prisma.taskOccurrence.updateMany({
    where: {
      id: { in: ready.map((r) => r.id) },
      reminderDispatchedAt: null,
    },
    data: { reminderDispatchedAt: stamp },
  });

  // Re-read only the rows WE actually stamped. Prisma's updateMany doesn't
  // return the ids, so we filter by our exact stamp — any concurrent worker
  // would have written a DIFFERENT Date, so our set is disjoint from theirs.
  const mineWithTask = await prisma.taskOccurrence.findMany({
    where: {
      id: { in: ready.map((r) => r.id) },
      reminderDispatchedAt: stamp,
    },
    include: { task: true },
  });

  let dispatched = 0;
  for (const occ of mineWithTask) {
    const task = occ.task;
    const dueLabel = occ.occurrenceAt.toISOString();
    const payload = {
      taskId: task.id,
      occurrenceId: occ.id,
      assignedTo: task.assignedTo,
      animalId: task.animalId,
      campId: task.campId,
      taskType: task.taskType,
    };

    const createInput: Prisma.NotificationCreateInput = {
      type: "TASK_REMINDER",
      severity: task.priority === "high" ? "red" : "amber",
      message: `Reminder: ${task.title} · due ${dueLabel}`,
      href: `/admin/tasks?taskId=${task.id}`,
      dedupKey: `TASK_REMINDER:${occ.id}`,
      collapseKey: `task-reminder:${occ.id}`,
      payload: JSON.stringify(payload),
      expiresAt: new Date(occ.occurrenceAt.getTime() + 24 * 60 * 60 * 1000),
    };

    try {
      await prisma.notification.create({ data: createInput });
      dispatched++;
    } catch (err) {
      // P2002 means another concurrent run already wrote this reminder — the
      // (type, dedupKey) unique constraint caught it. Per Phase J dedup.ts
      // lines 229-239, we swallow the duplicate (the winning row is already
      // persisted) rather than failing the whole step.
      if (!isP2002(err)) throw err;
    }
  }

  return {
    ready: ready.length,
    dispatched,
    raceSkipped: ready.length - stamped.count,
  };
}

// ── Registration surface ────────────────────────────────────────────────────

export const ALL_TASK_FUNCTIONS = [
  regenerateTaskOccurrences,
  regenerateTaskOccurrencesForTenant,
  dispatchTaskReminders,
  dispatchTaskRemindersForTenant,
];
