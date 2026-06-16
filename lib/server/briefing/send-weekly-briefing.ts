/**
 * lib/server/briefing/send-weekly-briefing.ts — Weekly Farm Briefing v1.
 *
 * The weekly EMAIL send path. Mirrors lib/server/alerts/digest-email.ts
 * (sendDailyDigest) but with a 7-day lookback and the briefing payload +
 * narrator instead of the alert-digest grouping.
 *
 * AUDIENCE GATE (decision 7 — no spamming, no migration): the email is sent
 * to a tenant ONLY if that tenant has at least one AlertPreference with
 * digestMode='weekly' (opt-in via the existing column). The in-app card
 * (getWeeklyBriefingForFarm) is ALWAYS on and does NOT consult this gate.
 *
 * Idempotency: the weekly CRON fires once per ISO week per tenant via a
 * week-stamped Inngest event id, so this function does not need its own
 * marker — the cron is the at-most-once boundary (functions.ts).
 *
 * AlertPreference / User are NOT species models — raw prisma is allowed.
 */

import type { PrismaClient, FarmSettings } from "@prisma/client";
import { sendEmail } from "@/lib/server/send-email";
import {
  assertWithinBudget,
  stampCostBeforeSend,
  reconcileCostAfterSend,
  EinsteinBudgetError,
} from "@/lib/einstein/budget";
import {
  SONNET_INPUT_USD_PER_1M,
  SONNET_OUTPUT_USD_PER_1M,
  ESTIMATED_OUTPUT_TOKENS,
} from "@/lib/einstein/defaults";
import { ZAR_PER_USD } from "@/lib/einstein/embeddings";
import { logger } from "@/lib/logger";
import { narrateBriefing, templatedBriefingNarration } from "./narrator";
import { collectBriefingSources } from "./collect";
import type { BriefingPayload } from "./payload";

/** Pessimistic pre-stamp token budget for the one-shot narration call. The
 *  briefing prompt is small (no methodology / no chunks), so the input is well
 *  below Einstein's RAG estimate; we reuse the shared output estimate. */
const BRIEFING_ESTIMATED_INPUT_TOKENS = 800;

function estimateNarrationCostZar(): number {
  const usd =
    (BRIEFING_ESTIMATED_INPUT_TOKENS / 1_000_000) * SONNET_INPUT_USD_PER_1M +
    (ESTIMATED_OUTPUT_TOKENS / 1_000_000) * SONNET_OUTPUT_USD_PER_1M;
  return usd * ZAR_PER_USD;
}

function actualNarrationCostZar(usage: { inputTokens: number; outputTokens: number }): number {
  const usd =
    (usage.inputTokens / 1_000_000) * SONNET_INPUT_USD_PER_1M +
    (usage.outputTokens / 1_000_000) * SONNET_OUTPUT_USD_PER_1M;
  return usd * ZAR_PER_USD;
}

export interface WeeklyBriefingResult {
  sent: boolean;
  reason?: string;
  to?: string;
  isEmpty?: boolean;
}

/** Audience gate: does any user on this tenant opt into the weekly digest? */
async function hasWeeklyOptIn(prisma: PrismaClient): Promise<boolean> {
  const count = await prisma.alertPreference.count({
    where: { digestMode: "weekly" },
  });
  return count > 0;
}

/** Resolve the briefing recipient — admin first, then any user (mirrors the
 *  daily-digest recipient resolution). */
async function findRecipientEmail(prisma: PrismaClient): Promise<string | null> {
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, select: { email: true } });
  if (admin?.email) return admin.email;
  const any = await prisma.user.findFirst({ select: { email: true } });
  return any?.email ?? null;
}

export async function sendWeeklyBriefing(
  prisma: PrismaClient,
  settings: Pick<FarmSettings, "farmName"> & { aiSettings?: string | null },
  farmSlug: string,
  now: Date = new Date(),
): Promise<WeeklyBriefingResult> {
  // 1. Audience gate — opt-in required, no spamming.
  if (!(await hasWeeklyOptIn(prisma))) {
    return { sent: false, reason: "no-weekly-optin" };
  }

  // 2. Resolve recipient.
  const to = await findRecipientEmail(prisma);
  if (!to) return { sent: false, reason: "no-admin-email" };

  // 3. Build the deterministic payload over the 7-day window. The recipient is
  //    the do-next feed owner for the email's "what to do" section.
  const { payload } = await collectBriefingSources(prisma, farmSlug, {
    now,
    userEmail: to,
    farmName: settings.farmName,
  });

  // 4. Narrate the email intro under the SAME AI budget guard Einstein uses
  //    (mark-before-send → reconcile). Fail-soft at every step: an over-budget
  //    tenant / missing settings / stamp failure degrades to the deterministic
  //    template intro instead of blocking the email (the briefing must always
  //    render). The in-app card never narrates, so it never touches budget.
  const assistantName = resolveAssistantName(settings.aiSettings ?? null);
  const intro = await narrateWithBudget(payload, assistantName, farmSlug);

  // 5. Send.
  const result = await sendEmail({
    to,
    template: "weekly-briefing",
    data: {
      farmSlug,
      farmName: payload.farmName,
      intro,
      whatChanged: payload.whatChanged,
      whatToWatch: payload.whatToWatch,
      whatToDo: payload.whatToDo,
    },
  });

  return { sent: result.sent, reason: result.skipped ?? result.error, to, isEmpty: payload.isEmpty };
}

/** Read the tenant's assistant name from the aiSettings JSON blob (falls back
 *  to the default inside the narrator). Best-effort — a parse failure yields
 *  the empty name and the narrator substitutes the default. */
function resolveAssistantName(aiSettings: string | null): string {
  if (!aiSettings) return "";
  try {
    const parsed = JSON.parse(aiSettings) as { assistantName?: unknown };
    return typeof parsed.assistantName === "string" ? parsed.assistantName : "";
  } catch {
    return "";
  }
}

/**
 * Generate the email intro under the AI budget guard. ALWAYS returns prose:
 *   - over budget / budget lookup failure → deterministic template intro,
 *     online narrator is NOT called (no spend on an exhausted tenant);
 *   - within budget → mark-before-send stamp, online narration (fail-soft to
 *     template inside narrateBriefing), then reconcile to real usage.
 */
async function narrateWithBudget(
  payload: BriefingPayload,
  assistantName: string,
  farmSlug: string,
): Promise<string> {
  const fallback = templatedBriefingNarration(payload, assistantName);

  try {
    await assertWithinBudget(farmSlug);
  } catch (err) {
    if (err instanceof EinsteinBudgetError) {
      logger.warn("[briefing] over budget — using template intro", {
        farmSlug,
        code: err.code,
      });
      return fallback;
    }
    // Unexpected budget-lookup failure: don't block the email, use the template.
    logger.warn("[briefing] budget check failed — using template intro", {
      farmSlug,
      err: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }

  // Mark-before-send: stamp the pessimistic estimate BEFORE the call (matches
  // the Einstein dispatch idempotency contract). A stamp failure falls back.
  const estimate = estimateNarrationCostZar();
  try {
    await stampCostBeforeSend(farmSlug, estimate);
  } catch (err) {
    logger.warn("[briefing] pre-stamp failed — using template intro", {
      farmSlug,
      err: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }

  let realUsage: { inputTokens: number; outputTokens: number } | null = null;
  const intro = await narrateBriefing(payload, assistantName, (u) => {
    realUsage = u;
  });

  // Reconcile the pessimistic stamp to actual usage. If the online call fell
  // back internally (no usage reported), credit the full estimate back.
  try {
    const u = realUsage as { inputTokens: number; outputTokens: number } | null;
    const actual = u ? actualNarrationCostZar(u) : 0;
    await reconcileCostAfterSend(farmSlug, actual - estimate);
  } catch (err) {
    logger.warn("[briefing] budget reconcile failed", {
      farmSlug,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return intro;
}

/**
 * In-app 'This week' card data (decision 8) — ALWAYS available, no audience
 * gate, no LLM (the dashboard hot path uses ONLY the deterministic payload).
 * Fail-open at the call-site (DashboardContent wraps this in try/catch).
 */
export async function getWeeklyBriefingForFarm(
  prisma: PrismaClient,
  farmSlug: string,
  userEmail: string,
  farmName: string,
  now: Date = new Date(),
): Promise<BriefingPayload> {
  const { payload } = await collectBriefingSources(prisma, farmSlug, {
    now,
    userEmail,
    farmName,
  });
  return payload;
}
