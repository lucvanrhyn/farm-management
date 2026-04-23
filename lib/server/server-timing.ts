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
 *   - Single dependency-free module. Safe to import from route handlers,
 *     middleware, and tests alike.
 *   - Bounded output. Cap at 8 entries so a mis-wired caller can't produce
 *     a multi-kilobyte header.
 */

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
