/**
 * Server-Timing helpers.
 *
 * Emits the [Server-Timing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing)
 * header so devtools and Lighthouse CI can see where each instrumented
 * API route spends its time (session verification, Prisma client acquisition,
 * actual query). This is the observability bedrock for Phase 1 of the
 * cold-perf plan — no fix works if we can't measure it.
 *
 * Design goals:
 *   - Zero throws. An instrumentation helper must never break the request.
 *   - Single dependency-free module (sans Node's AsyncLocalStorage). Safe
 *     to import from route handlers, middleware, and tests alike.
 *   - Bounded output. Cap at 8 entries so a mis-wired caller can't produce
 *     a multi-kilobyte header.
 *   - Zero-overhead off-switch. Deep helpers (like farm-prisma) call
 *     `recordTiming` unconditionally; when no bag is active the call is a
 *     single ALS lookup + early return.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Maximum number of entries we will emit, regardless of input size. */
const MAX_ENTRIES = 8;

/** Characters that would break `Server-Timing` syntax if left in a label. */
const UNSAFE_LABEL_CHARS = /[\s,;=]/g;

/**
 * Format a map of labelled durations (ms) into a `Server-Timing` header value.
 *
 * Returns an empty string when no valid entries are present; callers should
 * skip setting the header entirely in that case to avoid emitting an empty
 * header value.
 *
 * @example
 *   const header = emitServerTiming({ session: 12, "prisma-acquire": 340 });
 *   if (header) res.headers.set("Server-Timing", header);
 */
export function emitServerTiming(timings: Record<string, number>): string {
  try {
    const entries = Object.entries(timings ?? {});
    const out: string[] = [];

    for (const [rawLabel, rawDur] of entries) {
      if (out.length >= MAX_ENTRIES) break;
      if (!Number.isFinite(rawDur)) continue;

      const label = String(rawLabel).replace(UNSAFE_LABEL_CHARS, "");
      if (!label) continue;

      // Round to 1dp — keeps the header short while preserving enough
      // precision to spot 100-ms deltas between runs.
      const dur = Math.round(rawDur * 10) / 10;
      out.push(`${label};dur=${dur}`);
    }

    return out.join(", ");
  } catch {
    // Instrumentation must never break the request. Swallow and emit nothing.
    return "";
  }
}

// ── Request-scoped timing bag ────────────────────────────────────────────

/**
 * A mutable map of `label → duration(ms)`. One per in-flight request.
 * Deep helpers record into the bag; the outer handler reads it at
 * response time and passes it to `emitServerTiming`.
 */
export type TimingBag = Record<string, number>;

const timingStorage = new AsyncLocalStorage<TimingBag>();

/** Create an empty timing bag — call this at the top of a handler. */
export function createTimingBag(): TimingBag {
  return {};
}

/**
 * Run `fn` with `bag` attached as the current request's timing bag.
 * Any `recordTiming(...)` call made synchronously or asynchronously
 * within `fn` will write to this bag.
 *
 * Works for sync and async callbacks. Return value is pass-through.
 */
export function runWithTimingBag<T>(bag: TimingBag, fn: () => T): T {
  return timingStorage.run(bag, fn);
}

/** Return the currently-active timing bag, or `undefined` if none. */
export function getTimingBag(): TimingBag | undefined {
  return timingStorage.getStore();
}

/**
 * Write a labelled duration into the currently-active timing bag. Zero
 * overhead when no bag is active (single ALS lookup + early return).
 * Never throws.
 */
export function recordTiming(label: string, durationMs: number): void {
  try {
    const bag = timingStorage.getStore();
    if (!bag) return;
    if (!Number.isFinite(durationMs)) return;
    bag[label] = durationMs;
  } catch {
    // Instrumentation must never break the request.
  }
}

/**
 * Measure an async operation and record its duration into the active bag
 * under `label`. If no bag is active, the timer call is still cheap but
 * nothing is recorded. The original promise result is returned unchanged;
 * errors propagate normally so the caller's error-handling isn't altered.
 */
export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const bag = timingStorage.getStore();
  if (!bag) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    recordTiming(label, performance.now() - start);
  }
}
