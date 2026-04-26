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
// 4. keepalive: true — ensures the fetch completes even if the page is
//    unloading. This is critical for error-boundary and unload-handler sites.
//
// Usage (canonical form — default export):
//   import { clientLogger } from "@/lib/client-logger";
//   clientLogger.error("[register] submit failed", { err });
//   clientLogger.warn("[onboarding] boundary caught", { error });

type Level = "debug" | "info" | "warn" | "error";

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

async function send(
  level: Level,
  message: string,
  rawPayload?: Record<string, unknown>,
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

  try {
    const res = await fetch("/api/telemetry/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
  debug: (msg: string, payload?: Record<string, unknown>) =>
    send("debug", msg, payload),
  info: (msg: string, payload?: Record<string, unknown>) =>
    send("info", msg, payload),
  warn: (msg: string, payload?: Record<string, unknown>) =>
    send("warn", msg, payload),
  error: (msg: string, payload?: Record<string, unknown>) =>
    send("error", msg, payload),
};

export default clientLogger;
