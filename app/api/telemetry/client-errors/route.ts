/**
 * POST /api/telemetry/client-errors
 *
 * Receives structured log events from the browser (via `lib/client-logger.ts`)
 * and forwards them to the server-side logger so client errors flow into the
 * same structured-log stream as server events.
 *
 * Authentication: this endpoint is intentionally unauthenticated — matching
 * the /api/telemetry/vitals pattern. It is called from authenticated client
 * pages but may fire during session-load or error-boundary scenarios where a
 * session token is unavailable. Rate limiting is left as a TODO (see below).
 *
 * TODO(rate-limit): Wire `checkRateLimit` from `lib/rate-limit.ts` here once
 * a per-IP/session policy is decided. The in-memory limiter resets on cold
 * start so serverless semantics make global limits approximate at best. For
 * now, the server logger write is cheap (stdout/stderr only) so the blast
 * radius of an abuse case is low.
 *
 * Error codes (typed per silent-failure-pattern.md):
 *   invalid_json     — request body is not parseable JSON
 *   invalid_body     — body is not an object
 *   invalid_level    — level field missing or not in the allowed set
 *   invalid_message  — message field missing or empty
 *   invalid_ts       — ts field missing or not a finite number
 *   forward_failed   — server logger threw during forwarding
 */

import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";

type Level = "debug" | "info" | "warn" | "error";

const VALID_LEVELS = new Set<Level>(["debug", "info", "warn", "error"]);
const MAX_MESSAGE_LEN = 1024;
const MAX_UA_LEN = 512;
const MAX_URL_LEN = 2048;

interface ClientErrorBody {
  level: Level;
  message: string;
  payload?: Record<string, unknown>;
  ts: number;
  url?: string;
  userAgent?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Parse JSON ──────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid json", code: "invalid_json" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "body must be a JSON object", code: "invalid_body" },
      { status: 400 },
    );
  }

  const raw = body as Record<string, unknown>;

  // ── 2. Validate level ──────────────────────────────────────────────────────
  if (!VALID_LEVELS.has(raw.level as Level)) {
    return NextResponse.json(
      {
        error: `level must be one of: ${[...VALID_LEVELS].join(", ")}`,
        code: "invalid_level",
      },
      { status: 400 },
    );
  }

  // ── 3. Validate message ────────────────────────────────────────────────────
  if (typeof raw.message !== "string" || raw.message.trim().length === 0) {
    return NextResponse.json(
      { error: "message must be a non-empty string", code: "invalid_message" },
      { status: 400 },
    );
  }

  // ── 4. Validate ts ─────────────────────────────────────────────────────────
  if (typeof raw.ts !== "number" || !Number.isFinite(raw.ts)) {
    return NextResponse.json(
      { error: "ts must be a finite number (Unix ms)", code: "invalid_ts" },
      { status: 400 },
    );
  }

  // ── 5. Build validated payload ─────────────────────────────────────────────
  const validated: ClientErrorBody = {
    level: raw.level as Level,
    message: (raw.message as string).slice(0, MAX_MESSAGE_LEN),
    ts: raw.ts,
  };

  if (
    raw.payload !== null &&
    raw.payload !== undefined &&
    typeof raw.payload === "object" &&
    !Array.isArray(raw.payload)
  ) {
    validated.payload = raw.payload as Record<string, unknown>;
  }

  if (typeof raw.url === "string") {
    validated.url = raw.url.slice(0, MAX_URL_LEN);
  }

  const ua = req.headers.get("user-agent");
  validated.userAgent =
    typeof raw.userAgent === "string"
      ? raw.userAgent.slice(0, MAX_UA_LEN)
      : (ua ?? "").slice(0, MAX_UA_LEN);

  // ── 6. Forward to server logger ────────────────────────────────────────────
  // The recursive Error normaliser in lib/logger.ts handles any nested Error
  // fields in validated.payload correctly.
  const { level, ...rest } = validated;
  const logFn = logger[level];

  try {
    logFn("[client]", rest);
  } catch (err) {
    // DO NOT swallow — logger.X should never throw but if it does we surface it.
    logger.error("[telemetry/client-errors] forward failed", err as Error);
    return NextResponse.json(
      { error: "logger forwarding failed", code: "forward_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
