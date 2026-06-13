import { NextRequest } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  commitImport,
  type ImportRow,
  type CommitImportProgress,
  type CommitImportResult,
} from "@/lib/onboarding/commit-import";
import { logger } from "@/lib/logger";
import { routeError } from "@/lib/server/route";

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

/**
 * ImportJob statuses a reused job may be claimed FROM (S14 / OB-004/M4).
 * "running" is deliberately absent — an in-flight job must never be
 * double-claimed — and "complete" is rejected earlier with its own 409.
 * Legacy rows with a NULL status (the column is nullable) are treated as
 * claimable: under the current lifecycle every active run is stamped
 * "running", so NULL is definitionally not in flight.
 */
const RECLAIMABLE_STATUSES = ["pending", "failed"];

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
  if (!ctx) return routeError("AUTH_REQUIRED", "Unauthorized", 401);
  const { prisma, slug, role, session } = ctx;
  if (role !== "ADMIN") {
    return routeError("FORBIDDEN", "Forbidden", 403);
  }
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return routeError("FORBIDDEN", "Forbidden", 403);
  }

  let raw: RawBody;
  try {
    raw = (await req.json()) as RawBody;
  } catch {
    return routeError("INVALID_BODY", "Request body must be valid JSON.", 400);
  }

  const parsed = parseBody(raw);
  if ("error" in parsed) {
    return routeError("VALIDATION_FAILED", parsed.error, 400);
  }

  const rl = await checkRateLimit(
    `commit-import:${slug}`,
    MAX_COMMITS_PER_DAY,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rl.allowed) {
    const res = routeError(
      "RATE_LIMITED",
      "Daily import limit reached. Try again tomorrow or contact support.",
      429,
      { retryAfterMs: rl.retryAfterMs },
    );
    res.headers.set("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
    return res;
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
      return routeError("IMPORT_JOB_NOT_FOUND", "ImportJob not found", 404);
    }
    if (existing.farmId !== slug) {
      return routeError("CROSS_TENANT_FORBIDDEN", "Forbidden", 403);
    }
    if (existing.status === "complete") {
      return routeError(
        "IMPORT_JOB_ALREADY_COMPLETE",
        "ImportJob already complete",
        409,
      );
    }
    // S14 (OB-004/M4): ATOMIC claim. The pre-S14 code reused any
    // not-complete job (including "running"), so two concurrent commits of
    // the same job both proceeded — duplicate herd / count overwrite. The
    // conditional update below transitions the job into "running" only
    // from a re-claimable state; exactly one concurrent request can match,
    // every other gets count 0 and a typed 409.
    const claim = await prisma.importJob.updateMany({
      where: {
        id: parsed.importJobId,
        OR: [{ status: { in: RECLAIMABLE_STATUSES } }, { status: null }],
      },
      data: { status: "running" },
    });
    if (claim.count === 0) {
      return routeError(
        "IMPORT_JOB_ALREADY_RUNNING",
        "An import for this job is already in progress.",
        409,
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
        logger.error('[commit-import] fatal', err);
        // S14: release the claim (running -> failed) so a retry can
        // re-claim this job. Without this, a crashed run would leave the
        // job "running" forever and every retry would 409.
        try {
          await prisma.importJob.updateMany({
            where: { id: importJobId, status: "running" },
            data: { status: "failed" },
          });
        } catch (releaseErr) {
          logger.error(
            "[commit-import] failed to release ImportJob claim",
            releaseErr,
          );
        }
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
