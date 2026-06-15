/**
 * lib/server/narration/templated-fallback.ts
 *
 * The shared deterministic OFFLINE narrator.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Why this file exists
 * ──────────────────────────────────────────────────────────────────────
 * Einstein's online answer generator (`lib/einstein/answer.ts`) THROWS
 * `EINSTEIN_ANSWER_NO_KEY` when `ANTHROPIC_API_KEY` is absent — it has no
 * offline path at all. Every surface that wants prose therefore needs a
 * deterministic fallback so the product degrades to *plain English*, never
 * to a blank panel, when there is no key (CI, local dev, a tenant on the
 * trial tier with AI disabled, or a transient API outage).
 *
 * These are the shared, content-agnostic primitives. Feature narrators
 * (e.g. `lib/server/triage/narrate.ts`) compose them. Everything here is
 * PURE and TOTAL: same input → same output, no I/O, no clock read, no
 * randomness — exactly the contract `compose.ts` holds for alerts. That is
 * what lets a narrated string be unit-tested for an exact value.
 */

/**
 * Count + noun with English pluralisation. Pass `plural` for irregular
 * nouns (e.g. "cattle"); otherwise an "s" is appended for any count != 1.
 *
 *   pluralize(1, "animal")           → "1 animal"
 *   pluralize(2, "animal")           → "2 animals"
 *   pluralize(3, "cow", "cattle")    → "3 cattle"
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return `1 ${singular}`;
  return `${count} ${plural ?? `${singular}s`}`;
}

/**
 * Join clauses into a natural-language list with an Oxford "and":
 *
 *   []              → ""
 *   ["a"]           → "a"
 *   ["a","b"]       → "a and b"
 *   ["a","b","c"]   → "a, b, and c"
 */
export function joinClauses(clauses: readonly string[]): string {
  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  const head = clauses.slice(0, -1).join(", ");
  const tail = clauses[clauses.length - 1];
  return `${head}, and ${tail}`;
}

/**
 * Stable message for the "online narrator unavailable" case (no API key /
 * offline). A surface that wanted an Einstein one-liner but couldn't reach
 * the model shows this instead of a blank line. Deterministic and total.
 */
export function templatedFallbackUnavailable(): string {
  return "AI narration is offline right now — showing the plain-English summary instead.";
}
