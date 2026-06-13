import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  proposeColumnMapping,
  findImportInputCapViolation,
  AdaptiveImportError,
  type ProposeMappingInput,
} from "@/lib/onboarding/adaptive-import";
import { logger } from "@/lib/logger";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { routeError } from "@/lib/server/route";

/**
 * POST /api/onboarding/map-columns
 *
 * Workstream B3 — route handler that wraps B2's proposeColumnMapping().
 *
 * Body (JSON): { parsedColumns: string[], sampleRows: Record<string, unknown>[],
 *                fullRowCount: number }
 *
 * Server-side concerns:
 *   - next-auth session (401 if missing)
 *   - farm scoped by active_farm_slug cookie, ADMIN role required (403 otherwise)
 *   - 3 calls / farm / day rate limit (429)
 *   - request body shape guard (400 on malformed JSON or missing fields)
 *   - S16 (OB-002/M2) input caps — column count/length, row count, cell/key
 *     length, total payload bytes (IMPORT_INPUT_CAPS) — typed 400 BEFORE the
 *     rate limit is charged, so abusive payloads can't reach the LLM call
 *   - existing camps loaded from Prisma so Claude can fuzzy-match
 *   - upstream (Anthropic) failures surface as 502 with a safe message;
 *     unexpected errors surface as 500 with a generic message — never leak
 *     raw exception strings to the client
 */

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_CALLS_PER_DAY = 3;

type MapColumnsBody = {
  parsedColumns: unknown;
  sampleRows: unknown;
  fullRowCount: unknown;
};

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return routeError("AUTH_REQUIRED", "Unauthorized", 401);
  const { prisma, slug, role, session } = ctx;
  if (role !== "ADMIN") {
    return routeError("FORBIDDEN", "Forbidden", 403);
  }
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return routeError("FORBIDDEN", "Forbidden", 403);
  }

  let raw: MapColumnsBody;
  try {
    raw = (await req.json()) as MapColumnsBody;
  } catch {
    return routeError("INVALID_BODY", "Request body must be valid JSON.", 400);
  }

  const parsed = parseBody(raw);
  if ("error" in parsed) {
    return routeError("VALIDATION_FAILED", parsed.error, 400);
  }

  // S16 (OB-002/M2): size caps run after the shape guard but BEFORE the rate
  // limit so an oversized payload neither charges the daily budget nor
  // reaches the LLM call. Typed envelope per ADR-0001.
  const capViolation = findImportInputCapViolation(parsed);
  if (capViolation) {
    return routeError("VALIDATION_FAILED", capViolation.message, 400, {
      cap: capViolation.cap,
      limit: capViolation.limit,
      actual: capViolation.actual,
      field: capViolation.field,
    });
  }

  const rl = await checkRateLimit(
    `map-columns:${slug}`,
    MAX_CALLS_PER_DAY,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rl.allowed) {
    return routeError(
      "RATE_LIMITED",
      "Daily AI import limit reached. Try again tomorrow or contact support.",
      429,
      { retryAfterMs: rl.retryAfterMs },
    );
  }

  const existingCamps = await crossSpecies(
    prisma,
    "species-registry-internal",
  ).camp.findMany({
    select: { campId: true, campName: true, sizeHectares: true },
  });

  const input: ProposeMappingInput = {
    parsedColumns: parsed.parsedColumns,
    sampleRows: parsed.sampleRows,
    fullRowCount: parsed.fullRowCount,
    existingCamps: existingCamps.map((c) => ({
      campId: c.campId,
      campName: c.campName,
      ...(typeof c.sizeHectares === "number"
        ? { sizeHectares: c.sizeHectares }
        : {}),
    })),
  };

  try {
    const result = await proposeColumnMapping(input);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AdaptiveImportError) {
      // Upstream / parse failure — safe to surface a pointer, but not details.
      logger.error('[map-columns] AdaptiveImportError', { message: err.message });
      return routeError(
        "AI_IMPORT_UNAVAILABLE",
        "AI import service is currently unavailable.",
        502,
      );
    }
    logger.error('[map-columns] unexpected error', err);
    return routeError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

function parseBody(
  raw: MapColumnsBody
):
  | {
      parsedColumns: string[];
      sampleRows: Array<Record<string, unknown>>;
      fullRowCount: number;
    }
  | { error: string } {
  // Shape guard only — size caps (count/length/bytes) are enforced by
  // findImportInputCapViolation in the POST handler (S16 / OB-002).
  if (!Array.isArray(raw.parsedColumns) || raw.parsedColumns.length === 0) {
    return { error: "parsedColumns must be a non-empty array." };
  }
  if (!raw.parsedColumns.every((c) => typeof c === "string")) {
    return { error: "parsedColumns must contain only strings." };
  }
  if (!Array.isArray(raw.sampleRows)) {
    return { error: "sampleRows must be an array." };
  }
  if (
    !raw.sampleRows.every(
      (r) => typeof r === "object" && r !== null && !Array.isArray(r)
    )
  ) {
    return { error: "sampleRows entries must be objects." };
  }
  if (
    typeof raw.fullRowCount !== "number" ||
    !Number.isFinite(raw.fullRowCount) ||
    !Number.isInteger(raw.fullRowCount) ||
    raw.fullRowCount < 0
  ) {
    return { error: "fullRowCount must be a non-negative integer." };
  }

  return {
    parsedColumns: raw.parsedColumns as string[],
    sampleRows: raw.sampleRows as Array<Record<string, unknown>>,
    fullRowCount: raw.fullRowCount,
  };
}
