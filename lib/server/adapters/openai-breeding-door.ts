/**
 * #524 (PRD #521 Workstream E / umbrella #115) — zod boundary door for the
 * OpenAI breeding-completion response.
 *
 * THE single home for parsing the untrusted OpenAI Chat Completions payload that
 * `app/api/[farmSlug]/breeding/analyze/route.ts` receives. Before this module,
 * the route crossed that boundary with a DOUBLE type-assertion:
 *
 *     const openaiData = await openaiRes.json() as { choices: … };   // (1)
 *     parsed = JSON.parse(content) as BreedingAIResponse;            // (2)
 *
 * Both are unchecked `as` casts on data we do not own — exactly the boundary
 * ADR-0007 (#513) closes for observation `details`. This door mirrors that
 * pattern: one module, validated once with zod, returning a discriminated
 * `Result` so the caller branches on `ok` instead of trusting a cast.
 *
 * Design — deliberately mirrors `lib/domain/observations/details-schemas.ts`:
 *
 *   - **Discriminated `Result`** — `{ ok: true, value }` | `{ ok: false, error }`
 *     (the same shape/ergonomics as the ADR-0007 door surface).
 *
 *   - **`.passthrough()` (NOT `.strict()`)** on BOTH the outer envelope and the
 *     inner breeding payload: upstream additions (OpenAI's `system_fingerprint`,
 *     a future analysis field) must never turn into a regression. A schema here
 *     asserts the fields we READ are present/well-typed and lets everything else
 *     through untouched.
 *
 *   - **Coercion** for the stringly-typed numeric ambiguity: gpt-4o occasionally
 *     emits a number where the JSON contract asks for a string (and vice-versa).
 *     `z.coerce.string()` reproduces the permissive intent of the old bare cast
 *     without crashing the render.
 *
 *   - **Wire-behaviour preservation (criterion 3).** The legacy route 502'd
 *     ONLY when `JSON.parse(content)` threw. This door returns `ok: false` on
 *     (a) a malformed inner JSON string AND (b) an inner JSON that parses to a
 *     non-object (`[]`, `123`, `null`) — the latter being a latent bug the old
 *     `as` cast swallowed. The route maps BOTH to its existing
 *     `{ error: "Failed to parse AI response" }` 502, so the malformed-JSON wire
 *     response is byte-identical and the non-object case is merely tightened
 *     from a silent 200-with-garbage to the same honest 502.
 *
 *   - **Sparse-object tolerance.** A parseable inner OBJECT missing keys still
 *     succeeds (defaults applied), exactly as the old unchecked cast let a
 *     partial object through to the (defensively optional-chained) client.
 */
import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────────
// Typed error — the door's failure value. Mirrors ADR-0007's
// `DetailsValidationError`: a single typed error carrying the zod issue list so
// the boundary can forward field-level diagnostics. The route maps any door
// failure onto its existing 502 envelope, so this error's `code` is internal
// (diagnostics/logging), not a new wire code.
// ────────────────────────────────────────────────────────────────────────────

/** Stable code for a failed OpenAI breeding-completion parse (diagnostics). */
export const BREEDING_COMPLETION_PARSE_FAILED =
  "BREEDING_COMPLETION_PARSE_FAILED" as const;

/**
 * Raised (as the `error` arm of the {@link BreedingCompletionResult}) when the
 * OpenAI completion envelope or its inner breeding JSON fails validation. Never
 * thrown — the door returns it inside the discriminated Result so the caller is
 * forced to branch rather than catch.
 */
export class BreedingCompletionParseError extends Error {
  readonly code = BREEDING_COMPLETION_PARSE_FAILED;
  readonly issues: z.core.$ZodIssue[];
  constructor(message: string, issues: z.core.$ZodIssue[] = []) {
    super(message);
    this.name = "BreedingCompletionParseError";
    this.issues = issues;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Schemas.
// ────────────────────────────────────────────────────────────────────────────

/**
 * The inner breeding-analysis payload (the JSON string inside
 * `choices[0].message.content`). Mirrors the route's `BreedingAIResponse`
 * interface, with `.passthrough()` for forward-compat and defaults so a
 * parseable-but-sparse object survives (preserving the old cast's tolerance).
 *
 * Coercion (`z.coerce.string()`) absorbs the number-where-string drift gpt-4o
 * sometimes produces; array elements are coerced too.
 */
const breedingAnalysisSchema = z
  .object({
    summary: z.coerce.string().default(""),
    bullRecommendations: z.array(z.coerce.string()).default([]),
    calvingAlerts: z.array(z.coerce.string()).default([]),
    breedingWindowSuggestion: z.coerce.string().default(""),
    riskFlags: z.array(z.coerce.string()).default([]),
  })
  .passthrough();

/**
 * The validated inner breeding payload. Structurally identical to the route's
 * `BreedingAIResponse` (kept as the route's exported public type for the client
 * import), plus the passthrough index for any forward-compat upstream keys.
 */
export type BreedingAnalysis = z.infer<typeof breedingAnalysisSchema>;

/**
 * The outer OpenAI Chat Completions envelope — only the fields the route reads
 * are asserted; `.passthrough()` keeps everything else (`id`, `usage`,
 * `system_fingerprint`, …). `content` is coerced to a string with the same
 * `"{}"` fallback the route applied via `?? "{}"`, so an absent content yields
 * an empty (defaulted) analysis rather than a failure.
 */
const completionEnvelopeSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

// ────────────────────────────────────────────────────────────────────────────
// Discriminated Result + the door entry.
// ────────────────────────────────────────────────────────────────────────────

/** Success arm of the door. */
export interface BreedingCompletionOk {
  readonly ok: true;
  readonly value: BreedingAnalysis;
}

/** Failure arm of the door (carries the typed parse error). */
export interface BreedingCompletionErr {
  readonly ok: false;
  readonly error: BreedingCompletionParseError;
}

/** Discriminated Result — mirrors the ADR-0007 door surface. */
export type BreedingCompletionResult =
  | BreedingCompletionOk
  | BreedingCompletionErr;

/**
 * THE boundary door for the OpenAI breeding-completion response.
 *
 * Validates the raw `openaiRes.json()` value (`unknown`) end to end:
 *   1. the outer completion envelope (`choices[0].message.content` is a string),
 *   2. the inner `content` string (must `JSON.parse` to an OBJECT),
 *   3. the breeding-analysis shape (passthrough + coercion + defaults).
 *
 * Returns `{ ok: true, value }` with a typed {@link BreedingAnalysis} on
 * success, or `{ ok: false, error }` carrying a {@link BreedingCompletionParseError}
 * on any failure. The route maps the failure arm onto its existing
 * `{ error: "Failed to parse AI response" }` 502 (wire-preserving).
 *
 * No `as` cast crosses this boundary: the only assertions live INSIDE the
 * validated schema, not on the untrusted input.
 */
export function parseBreedingCompletion(
  raw: unknown,
): BreedingCompletionResult {
  // 1. Outer envelope.
  const envelope = completionEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return {
      ok: false,
      error: new BreedingCompletionParseError(
        "OpenAI completion envelope failed validation.",
        envelope.error.issues,
      ),
    };
  }

  // The route defaulted absent content to "{}". An empty string is treated the
  // same (a present-but-empty content is not a parse failure, it's an empty
  // analysis) so the door never 502s on a benign blank completion.
  const content = envelope.data.choices[0].message.content || "{}";

  // 2. Inner JSON — this is the throw the legacy route caught to emit its 502.
  let innerJson: unknown;
  try {
    innerJson = JSON.parse(content);
  } catch {
    return {
      ok: false,
      error: new BreedingCompletionParseError(
        "OpenAI completion content was not valid JSON.",
      ),
    };
  }

  // 3. Inner breeding payload. Rejecting a non-object (array / scalar / null)
  // closes the latent hole the old `as BreedingAIResponse` cast left open.
  const analysis = breedingAnalysisSchema.safeParse(innerJson);
  if (!analysis.success) {
    return {
      ok: false,
      error: new BreedingCompletionParseError(
        "OpenAI completion content was not a valid breeding analysis object.",
        analysis.error.issues,
      ),
    };
  }

  return { ok: true, value: analysis.data };
}
