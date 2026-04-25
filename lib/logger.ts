// lib/logger.ts
//
// Minimal structured logger. Replaces ad-hoc `console.*` calls in
// server-side code so production logs are machine-parseable JSON and
// development logs stay human-readable.
//
// Why not pino / winston / next-logger?
//
// 1. Vercel Functions already capture stdout/stderr, parse JSON lines,
//    and surface them in the dashboard. A 60-line wrapper around
//    `console.*` gets us all the production benefit at zero runtime
//    cost and zero bundle bloat (this module is server-only at the
//    consumption sites that actually need it).
// 2. We deliberately DO NOT swallow errors here — if structured fields
//    can't be JSON-stringified (cycles, BigInt) we fall back to
//    `String(value)` so the call still emits something.
//
// Usage:
//   import { logger } from "@/lib/logger";
//   logger.info("[export] generated", { type, format });
//   logger.warn("[sync] retry", { attempt });
//   logger.error("[register] provisioning failed", err);
//
// The second argument can be a `Record<string, unknown>` of structured
// fields, an `Error`, or any other value — we coerce sanely. Multiple
// trailing args are concatenated into a `details` array (matches the
// historical `console.error('msg', a, b)` shape).

type Level = "debug" | "info" | "warn" | "error";

interface LoggerLike {
  debug: (msg: string, ...rest: unknown[]) => void;
  info: (msg: string, ...rest: unknown[]) => void;
  warn: (msg: string, ...rest: unknown[]) => void;
  error: (msg: string, ...rest: unknown[]) => void;
}

const isProd = process.env.NODE_ENV === "production";

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    // Cycles / BigInt / functions — fall back to a flat coerce.
    return String(value);
  }
}

function serializeError(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: err.message,
    // Include a trimmed stack — full stacks bloat logs without paying for
    // themselves once Vercel has the source map. 2 KB is enough to point
    // at the throw site.
    stack: err.stack?.slice(0, 2048),
  };
}

// ─── Recursive payload normaliser ────────────────────────────────────────────
// Walks the value tree and converts any nested `Error` instance into a plain
// object `{ name, message, stack, cause? }` that JSON.stringify can serialise.
// Without this, JSON.stringify turns Error instances into `{}` — silently
// losing message and stack in production logs exactly when they're most needed.
//
// Safety guarantees:
//   • Cycle detection via WeakSet — circular refs become the string "[Circular]".
//   • Depth cap at 10 — guards against pathological deep structures.
//   • Primitives (string, number, boolean, null, undefined) pass through unchanged.

const MAX_DEPTH = 10;

function normalizeValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return "[MaxDepth]";

  // Primitives — nothing to do.
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  // Error instances — extract serialisable fields.
  if (value instanceof Error) {
    const serialized: Record<string, unknown> = serializeError(value);
    // Recursively normalise the cause chain if present.
    const cause = (value as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      serialized.cause = normalizeValue(cause, seen, depth + 1);
    }
    return serialized;
  }

  // Objects and arrays — both need cycle detection.
  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);

    if (Array.isArray(value)) {
      const result = value.map((item) => normalizeValue(item, seen, depth + 1));
      seen.delete(value as object);
      return result;
    }

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeValue(v, seen, depth + 1);
    }
    seen.delete(value as object);
    return result;
  }

  // Functions, symbols, bigint — coerce to string so they don't vanish.
  return String(value);
}

function normaliseRest(rest: unknown[]): unknown {
  if (rest.length === 0) return undefined;
  if (rest.length === 1) {
    const only = rest[0];
    // Top-level Error: preserve the existing { error: ... } wrapper shape.
    if (only instanceof Error) return { error: serializeError(only) };
    // Records / arrays / nested structures: walk recursively so any nested
    // Error instances survive JSON.stringify.
    if (only !== null && typeof only === "object") {
      return normalizeValue(only, new WeakSet(), 0);
    }
    return only;
  }
  return rest.map((r) =>
    r instanceof Error ? serializeError(r) : normalizeValue(r, new WeakSet(), 0),
  );
}

function emit(level: Level, msg: string, rest: unknown[]): void {
  const payload = normaliseRest(rest);

  if (isProd) {
    // Single-line JSON — Vercel parses these and lets you query by field.
    const line = {
      level,
      time: new Date().toISOString(),
      msg,
      ...(payload !== undefined ? { details: payload } : {}),
    };
    // Stringification can throw on cycles even when normaliseRest returned
    // an object that includes them — fall back to a sanitised line.
    let serialized: string;
    try {
      serialized = JSON.stringify(line);
    } catch {
      serialized = JSON.stringify({
        level,
        time: line.time,
        msg,
        details: safeStringify(payload),
      });
    }
    // eslint-disable-next-line no-console
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(serialized);
    return;
  }

  // Dev: keep the original colourful console for ergonomics. We still
  // forward `payload` as a second arg so devtools can collapse it.
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : level === "debug" ? console.debug : console.log;
  if (payload === undefined) {
    fn(msg);
  } else {
    fn(msg, payload);
  }
}

export const logger: LoggerLike = {
  debug: (msg, ...rest) => emit("debug", msg, rest),
  info: (msg, ...rest) => emit("info", msg, rest),
  warn: (msg, ...rest) => emit("warn", msg, rest),
  error: (msg, ...rest) => emit("error", msg, rest),
};
