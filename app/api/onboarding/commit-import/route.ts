import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  commitImport,
  type ImportRow,
  type CommitImportProgress,
  type CommitImportResult,
} from "@/lib/onboarding/commit-import";

/**
 * POST /api/onboarding/commit-import
 *
 * Workstream B4b — HTTP route that wraps B4a's commitImport() library and
 * streams per-phase progress back to the client via Server-Sent Events (SSE).
 *
 * Body (JSON):
 *   {
 *     rows: ImportRow[],           // max 10_000 entries
 *     defaultSpecies: string,      // "cattle" | "sheep" | "goats" | "game"
 *     importJobId?: string,        // reuse existing ImportJob if provided
 *     rowCount?: number,           // optional metadata for a new ImportJob
 *     sourceFilename?: string,     // optional provenance for a new ImportJob
 *     sourceFileHash?: string,     // optional provenance for a new ImportJob
 *     mappingJson?: string,        // optional provenance for a new ImportJob
 *   }
 *
 * Server-side concerns:
 *   - next-auth session (401 if missing)
 *   - farm scoped by active_farm_slug cookie, ADMIN role required (403 otherwise)
 *   - 3 commits / farm / day rate limit (429)
 *   - body-validate BEFORE rate-limit (matches B3 hardening — malformed
 *     requests must not burn the daily budget)
 *   - ImportJob row is created up-front when importJobId is absent so the
 *     library's final UPDATE always has a target
 *   - stream format: `event: progress\ndata: {...}\n\n` repeated,
 *     terminated by either `event: complete\ndata: CommitImportResult\n\n`
 *     or `event: error\ndata: {"message":"Import failed"}\n\n`
 *   - raw library errors are NEVER leaked to the client (generic message only)
 */

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_COMMITS_PER_DAY = 3;
const MAX_ROWS = 10_000;
const ALLOWED_SPECIES = new Set(["cattle", "sheep", "goats", "game"]);

type RawBody = {
  rows: unknown;
  defaultSpecies: unknown;
  importJobId?: unknown;
  rowCount?: unknown;
  sourceFilename?: unknown;
  sourceFileHash?: unknown;
  mappingJson?: unknown;
};

type ParsedBody = {
  rows: ImportRow[];
  defaultSpecies: string;
  importJobId?: string;
  rowCount?: number;
  sourceFilename?: string;
  sourceFileHash?: string;
  mappingJson?: string;
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

  let raw: RawBody;
  try {
    raw = (await req.json()) as RawBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = parseBody(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const rl = checkRateLimit(
    `commit-import:${slug}`,
    MAX_COMMITS_PER_DAY,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "Daily import limit reached. Try again tomorrow or contact support.",
        retryAfterMs: rl.retryAfterMs,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      },
    );
  }

  // Resolve or create an ImportJob. commitImport updates this row at the end
  // of the pipeline, so it must exist before we start streaming.
  const confirmedBy =
    session.user?.email ?? session.user?.name ?? "unknown";
  let importJobId: string;
  if (parsed.importJobId) {
    importJobId = parsed.importJobId;
  } else {
    const created = await prisma.importJob.create({
      data: {
        farmId: slug,
        sourceFileHash: parsed.sourceFileHash ?? "",
        sourceFilename: parsed.sourceFilename ?? "import.csv",
        mappingJson: parsed.mappingJson ?? "{}",
        confirmedBy,
        status: "running",
        rowsImported: 0,
        rowsFailed: 0,
      },
    });
    importJobId = created.id;
  }

  // SSE stream: every progress tick from commitImport is enqueued as an
  // `event: progress` frame; final result is a `complete` frame; library
  // failures surface as a single `error` frame with a generic message.
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      };

      try {
        const result: CommitImportResult = await commitImport(
          prisma,
          {
            rows: parsed.rows,
            importJobId,
            defaultSpecies: parsed.defaultSpecies,
          },
          (p: CommitImportProgress) => send("progress", p),
        );
        send("complete", result);
      } catch (err) {
        console.error("[commit-import] fatal", err);
        send("error", { message: "Import failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function parseBody(raw: RawBody): ParsedBody | { error: string } {
  if (!Array.isArray(raw.rows)) {
    return { error: "rows must be an array." };
  }
  if (raw.rows.length === 0 || raw.rows.length > MAX_ROWS) {
    return {
      error: `rows must contain between 1 and ${MAX_ROWS} entries.`,
    };
  }
  if (
    !raw.rows.every(
      (r) => typeof r === "object" && r !== null && !Array.isArray(r),
    )
  ) {
    return { error: "rows entries must be objects." };
  }

  if (
    typeof raw.defaultSpecies !== "string" ||
    !ALLOWED_SPECIES.has(raw.defaultSpecies)
  ) {
    return {
      error:
        "defaultSpecies must be one of: cattle, sheep, goats, game.",
    };
  }

  if (raw.importJobId !== undefined) {
    if (typeof raw.importJobId !== "string" || raw.importJobId.length === 0) {
      return { error: "Invalid importJobId." };
    }
  }

  if (raw.rowCount !== undefined) {
    if (
      typeof raw.rowCount !== "number" ||
      !Number.isFinite(raw.rowCount) ||
      !Number.isInteger(raw.rowCount) ||
      raw.rowCount < 0
    ) {
      return { error: "rowCount must be a non-negative integer." };
    }
  }

  for (const field of ["sourceFilename", "sourceFileHash", "mappingJson"] as const) {
    const v = raw[field];
    if (v !== undefined && (typeof v !== "string" || v.length > 2048)) {
      return { error: `Invalid ${field}.` };
    }
  }

  return {
    rows: raw.rows as ImportRow[],
    defaultSpecies: raw.defaultSpecies,
    importJobId: raw.importJobId as string | undefined,
    rowCount: raw.rowCount as number | undefined,
    sourceFilename: raw.sourceFilename as string | undefined,
    sourceFileHash: raw.sourceFileHash as string | undefined,
    mappingJson: raw.mappingJson as string | undefined,
  };
}
