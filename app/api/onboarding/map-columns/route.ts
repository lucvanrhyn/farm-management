import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  proposeColumnMapping,
  AdaptiveImportError,
  type ProposeMappingInput,
} from "@/lib/onboarding/adaptive-import";

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
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, slug, role, session } = ctx;
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: MapColumnsBody;
  try {
    raw = (await req.json()) as MapColumnsBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const parsed = parseBody(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const rl = checkRateLimit(
    `map-columns:${slug}`,
    MAX_CALLS_PER_DAY,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          "Daily AI import limit reached. Try again tomorrow or contact support.",
        retryAfterMs: rl.retryAfterMs,
      },
      { status: 429 }
    );
  }

  const existingCamps = await prisma.camp.findMany({
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
      console.error("[map-columns] AdaptiveImportError", err.message);
      return NextResponse.json(
        { error: "AI import service is currently unavailable." },
        { status: 502 }
      );
    }
    console.error("[map-columns] unexpected error", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
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
  if (
    !Array.isArray(raw.parsedColumns) ||
    raw.parsedColumns.length === 0 ||
    raw.parsedColumns.length > 200
  ) {
    return { error: "parsedColumns must contain between 1 and 200 strings." };
  }
  if (!raw.parsedColumns.every((c) => typeof c === "string")) {
    return { error: "parsedColumns must contain only strings." };
  }
  if (!Array.isArray(raw.sampleRows)) {
    return { error: "sampleRows must be an array." };
  }
  if (raw.sampleRows.length > 20) {
    return { error: "sampleRows must contain at most 20 rows." };
  }
  if (
    !raw.sampleRows.every(
      (r) => typeof r === "object" && r !== null && !Array.isArray(r)
    )
  ) {
    return { error: "sampleRows entries must be objects." };
  }
  for (const row of raw.sampleRows as Array<Record<string, unknown>>) {
    for (const v of Object.values(row)) {
      if (typeof v === "string" && v.length > 512) {
        return {
          error: "sampleRows string values must be 512 chars or fewer.",
        };
      }
    }
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
