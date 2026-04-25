/**
 * Phase L Wave 3E — PUT /api/[farmSlug]/farm-settings/methodology
 *
 * Writes the Farm Methodology Object subtree into FarmSettings.aiSettings
 * (JSON blob column). Merges rather than clobbers so concurrent writes to
 * /ai (rename, language, budget cap) don't stomp each other.
 *
 * Tier gate: paid only. Writes from Basic return 403 even though the UI
 * greys the form — defence-in-depth against direct API callers.
 *
 * Validation: every methodology field must be a string. Unknown keys are
 * rejected so the blob can't become a dumping ground for future frontends.
 *
 * Error codes (silent-failure cure pattern):
 *   AUTH_REQUIRED                 — 401
 *   FARM_ACCESS_DENIED            — 403, session user doesn't belong to farm
 *   EINSTEIN_TIER_LOCKED          — 403, paid-tier-only feature
 *   METHODOLOGY_INVALID_SHAPE     — 400, non-object or unknown keys
 *   METHODOLOGY_INVALID_FIELD     — 400, a field is not a string
 *   INVALID_BODY                  — 400, not JSON
 *   FARM_NOT_FOUND                — 404
 *   METHODOLOGY_SAVE_FAILED       — 500, DB write blew up
 */

import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { classifyFarmContextFailure } from "@/lib/server/farm-context-errors";
import { getFarmCreds } from "@/lib/meta-db";
import { isPaidTier, type FarmTier } from "@/lib/tier";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";
import { logger } from "@/lib/logger";
import {
  mergeAiSettings,
  parseAiSettings,
  type FarmMethodology,
} from "@/lib/einstein/settings-schema";

export const dynamic = "force-dynamic";

const METHODOLOGY_FIELDS: ReadonlyArray<keyof FarmMethodology> = [
  "tier",
  "speciesMix",
  "breedingCalendar",
  "rotationPolicy",
  "lsuThresholds",
  "farmerNotes",
];
const METHODOLOGY_FIELD_SET: ReadonlySet<string> = new Set(METHODOLOGY_FIELDS);

// Generous cap — the farmerNotes field is the catch-all and farmers can be
// verbose. 10k chars stops pathological blobs without clipping genuine use.
const MAX_FIELD_LEN = 10000;

function asErr(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: code, message },
    { status },
  );
}

interface MethodologyValidationOk {
  readonly ok: true;
  readonly value: FarmMethodology;
}
interface MethodologyValidationErr {
  readonly ok: false;
  readonly code: "METHODOLOGY_INVALID_SHAPE" | "METHODOLOGY_INVALID_FIELD";
  readonly message: string;
}

function validateMethodology(
  raw: unknown,
): MethodologyValidationOk | MethodologyValidationErr {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: "METHODOLOGY_INVALID_SHAPE",
      message: "methodology must be an object",
    };
  }
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!METHODOLOGY_FIELD_SET.has(key)) {
      return {
        ok: false,
        code: "METHODOLOGY_INVALID_SHAPE",
        message: `methodology has unknown key "${key}"`,
      };
    }
  }
  const next: Record<string, string> = {};
  for (const key of METHODOLOGY_FIELDS) {
    if (!(key in source)) continue;
    const value = source[key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string") {
      return {
        ok: false,
        code: "METHODOLOGY_INVALID_FIELD",
        message: `methodology.${key} must be a string`,
      };
    }
    if (value.length > MAX_FIELD_LEN) {
      return {
        ok: false,
        code: "METHODOLOGY_INVALID_FIELD",
        message: `methodology.${key} exceeds ${MAX_FIELD_LEN} characters`,
      };
    }
    next[key] = value;
  }
  return { ok: true, value: next as FarmMethodology };
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

  // Tier gate — Basic can read-preview but must not write.
  const creds = await getFarmCreds(farmSlug);
  const tier: FarmTier = (creds?.tier as FarmTier) ?? "basic";
  if (!isPaidTier(tier)) {
    return asErr(
      "EINSTEIN_TIER_LOCKED",
      "Farm Methodology editing is available on Advanced and Consulting plans",
      403,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return asErr("INVALID_BODY", "Body must be valid JSON", 400);
  }

  const validation = validateMethodology(body.methodology);
  if (!validation.ok) {
    return asErr(validation.code, validation.message, 400);
  }

  // Read-modify-write of the whole aiSettings blob. We accept the tiny race
  // window (two concurrent PUTs can last-write-wins on unrelated keys) —
  // the methodology editor is admin-only and one-user-at-a-time in practice.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma: any = ctx.prisma;
    const row = await prisma.farmSettings.findFirst({
      select: { aiSettings: true },
    });
    const existing = parseAiSettings(row?.aiSettings);
    const merged = mergeAiSettings(existing, { methodology: validation.value });
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
      methodology: validation.value,
    });
  } catch (err) {
    logger.error('[farm-settings/methodology] save failed', { farmSlug, err });
    return asErr(
      "METHODOLOGY_SAVE_FAILED",
      "Could not save methodology — please try again",
      500,
    );
  }
}
