import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CALLS_PER_DAY = 3;

type MapColumnsBody = {
  parsedColumns: unknown;
  sampleRows: unknown;
  fullRowCount: unknown;
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) {
    return NextResponse.json({ error: db.error }, { status: db.status });
  }
  const { prisma, slug, role } = db;
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rl = checkRateLimit(
    `map-columns:${slug}`,
    MAX_CALLS_PER_DAY,
    DAY_MS
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
  if (!Array.isArray(raw.parsedColumns) || raw.parsedColumns.length === 0) {
    return { error: "parsedColumns must be a non-empty array of strings." };
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
  if (
    typeof raw.fullRowCount !== "number" ||
    !Number.isFinite(raw.fullRowCount) ||
    raw.fullRowCount < 0
  ) {
    return { error: "fullRowCount must be a non-negative number." };
  }

  return {
    parsedColumns: raw.parsedColumns as string[],
    sampleRows: raw.sampleRows as Array<Record<string, unknown>>,
    fullRowCount: raw.fullRowCount,
  };
}
