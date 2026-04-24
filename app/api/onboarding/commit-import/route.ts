import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
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
 *     sourceFilename?: string,     // REQUIRED when importJobId is absent
 *     sourceFileHash?: string,     // REQUIRED when importJobId is absent
 *     mappingJson?: string,        // REQUIRED when importJobId is absent; must be valid JSON
 *   }
 *
 * Server-side concerns:
 *   - next-auth session (401 if missing)
 *   - farm scoped by active_farm_slug cookie, ADMIN role required (403 otherwise)
 *   - 3 commits / farm / day rate limit (429)
 *   - body-validate BEFORE rate-limit (matches B3 hardening — malformed
 *     requests must not burn the daily budget)
 *   - provenance fields (sourceFilename/sourceFileHash/mappingJson) are
 *     REQUIRED when auto-creating an ImportJob — no silent audit-defeating
 *     defaults
 *   - when importJobId is reused, verify ownership (same farm, not already
 *     complete) — returns 404/403/409 appropriately
 *   - commitImport is wrapped in a 90s timeout (above the library's internal
 *     60s transaction timeout) so a hung import surfaces as an SSE error
 *     frame instead of a dangling connection
 *   - ImportJob row is created up-front when importJobId is absent so the
 *     library's final UPDATE always has a target
 *   - stream format: `event: progress\ndata: {...}\n\n` repeated,
 *     terminated by either `event: complete\ndata: CommitImportResult\n\n`
 *     or `event: error\ndata: {"message":"..."}\n\n`
 *   - raw library errors are NEVER leaked to the client (generic message only)
 */

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_COMMITS_PER_DAY = 3;
const MAX_ROWS = 10_000;
const ALLOWED_SPECIES = new Set(["cattle", "sheep", "goats", "game"]);
const IMPORT_TIMEOUT_MS = 90_000;

type RawBody = {
  rows: unknown;
  defaultSpecies: unknown;
  importJobId?: unknown;
  sourceFilename?: unknown;
  sourceFileHash?: unknown;
  mappingJson?: unknown;
};

type ParsedBody = {
  rows: ImportRow[];
  defaultSpecies: string;
  importJobId?: string;
  sourceFilename?: string;
  sourceFileHash?: string;
  mappingJson?: string;
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
    // Caller supplied an existing ImportJob id — verify ownership + status
    // before touching it. Prisma is already farm-scoped so the farmId check
    // is defense-in-depth.
    const existing = await prisma.importJob.findUnique({
      where: { id: parsed.importJobId },
      select: { id: true, status: true, farmId: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "ImportJob not found" },
        { status: 404 },
      );
    }
    if (existing.farmId !== slug) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.status === "complete") {
      return NextResponse.json(
        { error: "ImportJob already complete" },
        { status: 409 },
      );
    }
    importJobId = parsed.importJobId;
  } else {
    // parseBody guarantees these are present + valid when importJobId is absent.
    const created = await prisma.importJob.create({
      data: {
        farmId: slug,
        sourceFileHash: parsed.sourceFileHash!,
        sourceFilename: parsed.sourceFilename!,
        mappingJson: parsed.mappingJson!,
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

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Import timeout")),
          IMPORT_TIMEOUT_MS,
        ),
      );

      try {
        const result: CommitImportResult = await Promise.race([
          commitImport(
            prisma,
            {
              rows: parsed.rows,
              importJobId,
              defaultSpecies: parsed.defaultSpecies,
            },
            (p: CommitImportProgress) => send("progress", p),
          ),
          timeoutPromise,
        ]);
        send("complete", result);
      } catch (err) {
        console.error("[commit-import] fatal", err);
        const message =
          err instanceof Error && err.message === "Import timeout"
            ? "Import timed out — please reduce batch size and retry"
            : "Import failed";
        send("error", { message });
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

  // Shape-check provenance fields regardless of whether importJobId is set,
  // so malformed strings always 400 rather than silently ignored.
  for (const field of ["sourceFilename", "sourceFileHash", "mappingJson"] as const) {
    const v = raw[field];
    if (v !== undefined && (typeof v !== "string" || v.length > 2048)) {
      return { error: `Invalid ${field}.` };
    }
  }

  // When creating a NEW ImportJob, provenance is required (no defaults).
  if (raw.importJobId === undefined) {
    if (
      typeof raw.sourceFilename !== "string" ||
      raw.sourceFilename.length === 0 ||
      typeof raw.sourceFileHash !== "string" ||
      raw.sourceFileHash.length === 0 ||
      typeof raw.mappingJson !== "string" ||
      raw.mappingJson.length === 0
    ) {
      return {
        error:
          "sourceFilename, sourceFileHash, and mappingJson are required when creating a new ImportJob.",
      };
    }
    try {
      JSON.parse(raw.mappingJson);
    } catch {
      return {
        error: "Invalid mappingJson (must be valid JSON string)",
      };
    }
  }

  return {
    rows: raw.rows as ImportRow[],
    defaultSpecies: raw.defaultSpecies,
    importJobId: raw.importJobId as string | undefined,
    sourceFilename: raw.sourceFilename as string | undefined,
    sourceFileHash: raw.sourceFileHash as string | undefined,
    mappingJson: raw.mappingJson as string | undefined,
  };
}
