// lib/client-logger.ts
//
// Browser-side structured logger. Mirrors the server `lib/logger.ts` API
// (info, warn, error, debug) and ships each call as a structured JSON payload
// to `/api/telemetry/client-errors` where the server logger picks it up.
//
// Design decisions:
//
// 1. SSR safety — every method guards on `typeof window === "undefined"` so
//    accidental imports in Server Components or `getServerSideProps` are silent
//    no-ops. The module is safe to import from "use client" components only.
//
// 2. Error serialisation — `JSON.stringify` silently drops Error prototype
//    fields (message, name, stack), producing `{}`. We walk the payload tree
//    recursively and extract those fields before serialising, matching the
//    server logger's behaviour.
//
// 3. Failure mode — if the POST fails (network error, 4xx, 5xx) we fall back
//    to `console.<level>` and swallow. Observability must never crash the page.
//
// 4. Unload-time delivery — for sends that fire as the page tears down
//    (error boundaries, `pagehide` / `visibilitychange` handlers) pass
//    `{ unload: true }`. Those use `navigator.sendBeacon`, the browser API
//    purpose-built to survive unload: the request is handed to the browser's
//    background-send queue and is not tied to the document's lifetime. When
//    `sendBeacon` is unavailable (or its queue is full and it returns false)
//    we fall back to the regular `fetch({ keepalive: true })` path. Non-unload
//    sends always use `fetch` so the caller can await completion + see HTTP
//    status (sendBeacon is fire-and-forget with no response). Both paths reach
//    `/api/telemetry/client-errors`, which bypasses the service worker
//    (see `lib/sw/telemetry-bypass.ts`) for native, un-aborted delivery.
//
// 5. Failure mode parity — `keepalive: true` stays on the fetch fallback so
//    delivery still completes if the page is unloading and we couldn't use a
//    beacon. Observability must never crash the page.
//
// Usage (canonical form — default export):
//   import { clientLogger } from "@/lib/client-logger";
//   clientLogger.error("[register] submit failed", { err });
//   clientLogger.warn("[onboarding] boundary caught", { error });
//   clientLogger.error("[unload] last gasp", { err }, { unload: true });

type Level = "debug" | "info" | "warn" | "error";

interface SendOptions {
  /**
   * When true, the page may be unloading — prefer `navigator.sendBeacon`,
   * which the browser delivers from a background queue independent of the
   * document lifetime. Falls back to `fetch({ keepalive: true })` when
   * `sendBeacon` is unavailable or refuses the payload.
   */
  unload?: boolean;
}

interface ClientLogPayload {
  level: Level;
  message: string;
  payload?: Record<string, unknown>;
  ts: number;
  url?: string;
  userAgent?: string;
}

// ─── Error serialisation ──────────────────────────────────────────────────────
// Mirrors the server logger's recursive normaliser so nested Error instances
// survive JSON.stringify rather than collapsing to {}.

function serializeError(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: err.message,
    stack: err.stack?.slice(0, 2048),
  };
}

const MAX_DEPTH = 10;

function normalizeForJson(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return "[MaxDepth]";

  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Error) {
    const serialized: Record<string, unknown> = serializeError(value);
    const cause = (value as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      serialized.cause = normalizeForJson(cause, seen, depth + 1);
    }
    return serialized;
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);

    if (Array.isArray(value)) {
      const result = value.map((item) =>
        normalizeForJson(item, seen, depth + 1),
      );
      seen.delete(value as object);
      return result;
    }

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeForJson(v, seen, depth + 1);
    }
    seen.delete(value as object);
    return result;
  }

  return String(value);
}

function normalizePayload(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  // Top-level Error — treat it like the server logger's { error: ... } path
  if (raw instanceof Error) {
    return serializeError(raw);
  }
  return normalizeForJson(raw, new WeakSet(), 0) as Record<string, unknown>;
}

// ─── Console fallback ─────────────────────────────────────────────────────────
// Used when the POST fails. Maps log level to the appropriate console method
// so the message isn't silently lost and keeps the expected severity in devtools.

const CONSOLE_MAP: Record<Level, (...args: unknown[]) => void> = {
  error: console.error,
  warn: console.warn,
  debug: console.debug,
  info: console.info,
};

// ─── Core send ────────────────────────────────────────────────────────────────

const ENDPOINT = "/api/telemetry/client-errors";

async function send(
  level: Level,
  message: string,
  rawPayload?: Record<string, unknown>,
  options?: SendOptions,
): Promise<void> {
  // SSR guard — must be first check in every exported method.
  if (typeof window === "undefined") return;

  const body: ClientLogPayload = {
    level,
    message,
    ts: Date.now(),
    url: window.location.href,
    userAgent: navigator.userAgent,
  };

  const payload = normalizePayload(rawPayload);
  if (payload !== undefined) body.payload = payload;

  const serialized = JSON.stringify(body);

  // Unload-time delivery: prefer sendBeacon (survives page teardown via the
  // browser's background-send queue, independent of the document lifetime).
  // Returns false if the user agent could not queue the beacon — fall through
  // to the fetch path in that case.
  if (
    options?.unload &&
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
  ) {
    try {
      const blob = new Blob([serialized], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    } catch {
      // fall through to fetch
    }
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized,
      keepalive: true,
    });

    if (!res.ok) {
      // HTTP error — fall back to console so the message isn't lost entirely.
      CONSOLE_MAP[level](`[client-logger] server rejected (${res.status})`, message, rawPayload);
    }
  } catch {
    // Network error — fall back to console.
    CONSOLE_MAP[level](`[client-logger] send failed`, message, rawPayload);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const clientLogger = {
  debug: (msg: string, payload?: Record<string, unknown>, options?: SendOptions) =>
    send("debug", msg, payload, options),
  info: (msg: string, payload?: Record<string, unknown>, options?: SendOptions) =>
    send("info", msg, payload, options),
  warn: (msg: string, payload?: Record<string, unknown>, options?: SendOptions) =>
    send("warn", msg, payload, options),
  error: (msg: string, payload?: Record<string, unknown>, options?: SendOptions) =>
    send("error", msg, payload, options),
};

export default clientLogger;
