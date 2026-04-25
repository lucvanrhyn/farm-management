/**
 * Phase L Wave 3E — PUT /api/[farmSlug]/farm-settings/ai
 *
 * Writes the three Einstein "top-of-form" settings into FarmSettings.aiSettings:
 *   - assistantName     (rename — string | "" for reset)
 *   - responseLanguage  ("en" | "af" | "auto")
 *   - budgetCapZarPerMonth (number, nested under ragConfig — Advanced only;
 *     Consulting tenants are budget-exempt and the client omits this key)
 *
 * Merges rather than clobbers so concurrent writes from the methodology
 * editor don't get stomped.
 *
 * Tier gate: paid only. Basic attempts get 403 even though the UI greys the
 * form — defence-in-depth against direct API callers.
 *
 * Error codes (silent-failure cure pattern):
 *   AUTH_REQUIRED                 — 401
 *   FARM_ACCESS_DENIED            — 403, session user doesn't belong to farm
 *   EINSTEIN_TIER_LOCKED          — 403, paid-tier-only feature
 *   AI_INVALID_NAME               — 400, bad chars or over length
 *   AI_INVALID_LANGUAGE           — 400, not en|af|auto
 *   AI_INVALID_BUDGET             — 400, NaN or out of [MIN,MAX]
 *   AI_BUDGET_NOT_ALLOWED         — 400, Consulting must not set a cap
 *   INVALID_BODY                  — 400, not JSON
 *   FARM_NOT_FOUND                — 404
 *   AI_SETTINGS_SAVE_FAILED       — 500, DB write blew up
 */

import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { classifyFarmContextFailure } from "@/lib/server/farm-context-errors";
import { getFarmCreds } from "@/lib/meta-db";
import { isPaidTier, isBudgetExempt, type FarmTier } from "@/lib/tier";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";
import { logger } from "@/lib/logger";
import {
  ASSISTANT_NAME_MAX_LEN,
  ASSISTANT_NAME_REGEX,
  BUDGET_CAP_MAX_ZAR,
  BUDGET_CAP_MIN_ZAR,
  mergeAiSettings,
  parseAiSettings,
  type AiSettings,
  type RagConfig,
  type ResponseLanguage,
} from "@/lib/einstein/settings-schema";

export const dynamic = "force-dynamic";

function asErr(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: code, message },
    { status },
  );
}

interface AiPatch {
  readonly assistantName?: string;
  readonly responseLanguage?: ResponseLanguage;
  readonly budgetCapZarPerMonth?: number;
}

type ValidationOk = { readonly ok: true; readonly value: AiPatch };
type ValidationErr = {
  readonly ok: false;
  readonly code:
    | "AI_INVALID_NAME"
    | "AI_INVALID_LANGUAGE"
    | "AI_INVALID_BUDGET"
    | "AI_BUDGET_NOT_ALLOWED";
  readonly message: string;
};

function validateBody(
  raw: Record<string, unknown>,
  budgetExempt: boolean,
): ValidationOk | ValidationErr {
  const patch: { -readonly [K in keyof AiPatch]: AiPatch[K] } = {};

  // Rename ────────────────────────────────────────────────────────────────
  if ("assistantName" in raw) {
    const value = raw.assistantName;
    if (typeof value !== "string") {
      return {
        ok: false,
        code: "AI_INVALID_NAME",
        message: "assistantName must be a string",
      };
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      // Empty string = explicit reset — store empty so `effectiveAssistantName`
      // falls back to the DEFAULT_ASSISTANT_NAME constant.
      patch.assistantName = "";
    } else {
      if (trimmed.length > ASSISTANT_NAME_MAX_LEN) {
        return {
          ok: false,
          code: "AI_INVALID_NAME",
          message: `assistantName exceeds ${ASSISTANT_NAME_MAX_LEN} characters`,
        };
      }
      if (!ASSISTANT_NAME_REGEX.test(trimmed)) {
        return {
          ok: false,
          code: "AI_INVALID_NAME",
          message:
            "assistantName may only contain letters, numbers, spaces, . ' or -",
        };
      }
      patch.assistantName = trimmed;
    }
  }

  // Response language ─────────────────────────────────────────────────────
  if ("responseLanguage" in raw) {
    const value = raw.responseLanguage;
    if (value !== "en" && value !== "af" && value !== "auto") {
      return {
        ok: false,
        code: "AI_INVALID_LANGUAGE",
        message: "responseLanguage must be one of: en, af, auto",
      };
    }
    patch.responseLanguage = value;
  }

  // Budget cap ────────────────────────────────────────────────────────────
  if ("budgetCapZarPerMonth" in raw) {
    if (budgetExempt) {
      return {
        ok: false,
        code: "AI_BUDGET_NOT_ALLOWED",
        message: "Consulting-tier tenants are budget-exempt",
      };
    }
    const value = raw.budgetCapZarPerMonth;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return {
        ok: false,
        code: "AI_INVALID_BUDGET",
        message: "budgetCapZarPerMonth must be a finite number",
      };
    }
    if (value < BUDGET_CAP_MIN_ZAR || value > BUDGET_CAP_MAX_ZAR) {
      return {
        ok: false,
        code: "AI_INVALID_BUDGET",
        message: `budgetCapZarPerMonth must be between R${BUDGET_CAP_MIN_ZAR} and R${BUDGET_CAP_MAX_ZAR}`,
      };
    }
    patch.budgetCapZarPerMonth = value;
  }

  return { ok: true, value: patch };
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) {
    const { code, status } = await classifyFarmContextFailure(req);
    const mapped = code === "CROSS_TENANT_FORBIDDEN" ? "FARM_ACCESS_DENIED" : code;
    return asErr(mapped, code === "AUTH_REQUIRED" ? "Sign in required" : "Forbidden", status);
  }

  // Tier gate — Basic must not write.
  const creds = await getFarmCreds(farmSlug);
  const tier: FarmTier = (creds?.tier as FarmTier) ?? "basic";
  if (!isPaidTier(tier)) {
    return asErr(
      "EINSTEIN_TIER_LOCKED",
      "Einstein AI settings are available on Advanced and Consulting plans",
      403,
    );
  }
  const budgetExempt = isBudgetExempt(tier);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return asErr("INVALID_BODY", "Body must be valid JSON", 400);
  }

  const validation = validateBody(body, budgetExempt);
  if (!validation.ok) {
    return asErr(validation.code, validation.message, 400);
  }

  // Build the merge patch. Top-level for assistantName + responseLanguage;
  // budget cap nests under ragConfig (see AiSettings schema). We carry the
  // existing ragConfig forward so runtime budget counters aren't wiped.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma: any = ctx.prisma;
    const row = await prisma.farmSettings.findFirst({
      select: { aiSettings: true },
    });
    const existing = parseAiSettings(row?.aiSettings);

    // Mutable local shape — `AiSettings` is readonly by design for callers,
    // but we're building the patch here and immediately handing it to the
    // (immutable) merge helper.
    const patch: {
      assistantName?: string;
      responseLanguage?: ResponseLanguage;
      ragConfig?: RagConfig;
    } = {};
    if ("assistantName" in validation.value) {
      patch.assistantName = validation.value.assistantName;
    }
    if ("responseLanguage" in validation.value) {
      patch.responseLanguage = validation.value.responseLanguage;
    }
    if ("budgetCapZarPerMonth" in validation.value) {
      const existingRag: Partial<RagConfig> = existing.ragConfig ?? {};
      patch.ragConfig = {
        enabled: existingRag.enabled ?? true,
        budgetCapZarPerMonth: validation.value.budgetCapZarPerMonth!,
        monthSpentZar: existingRag.monthSpentZar ?? 0,
        currentMonthKey: existingRag.currentMonthKey ?? "",
      };
    }

    const merged = mergeAiSettings(existing, patch as Partial<AiSettings>);
    const serialised = JSON.stringify(merged);

    if (row) {
      await prisma.farmSettings.updateMany({
        data: { aiSettings: serialised },
      });
    } else {
      // Brand-new tenant with no FarmSettings row — upsert the singleton.
      await prisma.farmSettings.upsert({
        where: { id: "singleton" },
        update: { aiSettings: serialised },
        create: {
          id: "singleton",
          farmName: "My Farm",
          breed: "Mixed",
          aiSettings: serialised,
        },
      });
    }

    revalidateSettingsWrite(farmSlug);
    return NextResponse.json({
      success: true,
      settings: {
        assistantName: merged.assistantName ?? "",
        responseLanguage: merged.responseLanguage ?? "auto",
        budgetCapZarPerMonth:
          merged.ragConfig?.budgetCapZarPerMonth ?? null,
      },
    });
  } catch (err) {
    logger.error('[farm-settings/ai] save failed', { farmSlug, err });
    return asErr(
      "AI_SETTINGS_SAVE_FAILED",
      "Could not save settings — please try again",
      500,
    );
  }
}
