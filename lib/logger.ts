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

function normaliseRest(rest: unknown[]): unknown {
  if (rest.length === 0) return undefined;
  if (rest.length === 1) {
    const only = rest[0];
    if (only instanceof Error) return { error: serializeError(only) };
    return only;
  }
  return rest.map((r) => (r instanceof Error ? serializeError(r) : r));
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
