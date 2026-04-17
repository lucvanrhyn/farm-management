/**
 * lib/onboarding/adaptive-import.ts
 *
 * Workstream B2 — OpenAI SDK client + prompt caching.
 *
 * Wraps [schema-dictionary.ts] (B1) as the system prompt, calls OpenAI
 * (gpt-4o-mini, JSON mode), parses the JSON mapping proposal, and returns
 * it alongside usage/cost telemetry.
 *
 * Scope (intentionally narrow):
 *   - Server-side only. No routes, no file parsing, no UI.
 *   - Text input (already-parsed columns + sample rows + camp list).
 *   - Vision support (scanned PDFs, notebook photos) is a follow-up.
 *
 * Prompt caching note: OpenAI caches prompts >= 1024 tokens automatically
 * (no `cache_control` markers required) and surfaces the cached-token count
 * via `response.usage.prompt_tokens_details.cached_tokens`. The cached-input
 * discount is applied automatically — there is no separate cache-write fee.
 */

import OpenAI from "openai";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } from "./schema-dictionary";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MODEL_ID = "gpt-4o-mini" as const;

/**
 * gpt-4o-mini pricing per million tokens (USD). Pinned in source so cost
 * telemetry is reproducible and auditable; update alongside F3 dashboard
 * work if OpenAI changes rates.
 *
 *   input          $0.15  /Mtok
 *   output         $0.60  /Mtok
 *   cached input   $0.075 /Mtok   (50% of input; applied automatically)
 *
 * OpenAI does NOT charge a separate cache-write fee — cache creation is
 * billed at the normal input rate and cached reads get the discount above.
 */
export const GPT_4O_MINI_RATES = Object.freeze({
  inputUsdPerMtok: 0.15,
  outputUsdPerMtok: 0.6,
  cachedInputUsdPerMtok: 0.075,
});

/**
 * USD -> ZAR spot rate used for telemetry. Update quarterly from SARB, or
 * swap to a live rate source once F3 cost dashboard needs finer tracking.
 */
export const ZAR_PER_USD = 18.5;

const MAX_SAMPLE_ROWS = 20;
const MAX_OUTPUT_TOKENS = 4096;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnMapping = {
  source: string;
  target: string;
  confidence: number;
  transform?: string;
  fuzzy_matches?: Array<{ source_value: string; camp_id: string }>;
  approximate?: boolean;
};

export type UnmappedColumn = {
  source: string;
  samples: string[];
  upsell_hint: string;
};

export type MappingProposal = {
  mapping: ColumnMapping[];
  unmapped: UnmappedColumn[];
  warnings: string[];
  row_count: number;
};

export type ProposeMappingInput = {
  parsedColumns: string[];
  sampleRows: Array<Record<string, unknown>>;
  existingCamps: Array<{
    campId: string;
    campName: string;
    sizeHectares?: number;
  }>;
  fullRowCount: number;
};

export type ProposalUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  costZar: number;
};

export type ProposalResult = {
  proposal: MappingProposal;
  usage: ProposalUsage;
  model: typeof MODEL_ID;
  promptVersion: string;
};

type RawApiUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number | null;
};

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class AdaptiveImportError extends Error {
  readonly rawResponse?: string;
  override readonly cause?: unknown;

  constructor(
    message: string,
    options: { rawResponse?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "AdaptiveImportError";
    this.rawResponse = options.rawResponse;
    this.cause = options.cause;
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AdaptiveImportError(
      "OPENAI_API_KEY must be set in environment variables."
    );
  }
  return new OpenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function buildUserPrompt(input: ProposeMappingInput): string {
  const { parsedColumns, sampleRows, existingCamps, fullRowCount } = input;

  const columnsBlock = `Columns (${parsedColumns.length}):\n${parsedColumns
    .map((c) => `  - ${c}`)
    .join("\n")}`;

  const campsBlock =
    existingCamps.length === 0
      ? "Existing camps (0): none"
      : `Existing camps (${existingCamps.length}):\n${existingCamps
          .map((c) => {
            const size =
              typeof c.sizeHectares === "number"
                ? ` (${c.sizeHectares} ha)`
                : "";
            return `  - ${c.campId} | ${c.campName}${size}`;
          })
          .join("\n")}`;

  const rowsJson = JSON.stringify(sampleRows, null, 2);
  const rowsBlock = `Sample rows (${sampleRows.length}):\n${rowsJson}`;

  return [
    `Row count: ${fullRowCount}`,
    columnsBlock,
    campsBlock,
    rowsBlock,
    "Return a single JSON mapping proposal as specified in the system prompt.",
  ].join("\n\n");
}

export function parseProposalJson(raw: string): unknown {
  const stripped = stripCodeFences(raw).trim();
  if (!stripped.startsWith("{") && !stripped.startsWith("[")) {
    throw new AdaptiveImportError(
      "Model response did not contain a JSON object.",
      { rawResponse: raw }
    );
  }
  try {
    return JSON.parse(stripped);
  } catch (err) {
    throw new AdaptiveImportError("Failed to parse model response as JSON.", {
      rawResponse: raw,
      cause: err,
    });
  }
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  // Matches opening ```json\n or ```\n and trailing ```.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) return fenceMatch[1];
  // Fallback: drop first line and any trailing ```.
  const lines = trimmed.split("\n");
  lines.shift();
  if (lines[lines.length - 1]?.trim() === "```") lines.pop();
  return lines.join("\n");
}

export function validateMappingProposal(raw: unknown): MappingProposal {
  if (!isPlainObject(raw)) {
    throw new AdaptiveImportError(
      "Proposal root is not a JSON object.",
      rawContext(raw)
    );
  }

  const { mapping, unmapped, warnings, row_count } = raw as Record<
    string,
    unknown
  >;

  if (!Array.isArray(mapping)) {
    throw new AdaptiveImportError(
      "Proposal missing required `mapping` array.",
      rawContext(raw)
    );
  }
  if (typeof row_count !== "number" || !Number.isFinite(row_count)) {
    throw new AdaptiveImportError(
      "Proposal `row_count` must be a finite number.",
      rawContext(raw)
    );
  }

  const coercionWarnings: string[] = [];
  const validatedMapping: ColumnMapping[] = mapping.map((entry, idx) => {
    if (!isPlainObject(entry)) {
      throw new AdaptiveImportError(
        `mapping[${idx}] is not an object.`,
        rawContext(raw)
      );
    }
    const m = entry as Record<string, unknown>;
    if (typeof m.source !== "string") {
      throw new AdaptiveImportError(
        `mapping[${idx}].source must be a string.`,
        rawContext(raw)
      );
    }
    if (typeof m.target !== "string") {
      throw new AdaptiveImportError(
        `mapping[${idx}].target must be a string.`,
        rawContext(raw)
      );
    }
    if (typeof m.confidence !== "number" || !Number.isFinite(m.confidence)) {
      throw new AdaptiveImportError(
        `mapping[${idx}].confidence must be a finite number.`,
        rawContext(raw)
      );
    }
    let confidence = m.confidence;
    if (confidence > 1) {
      coercionWarnings.push(
        `Coerced mapping[${idx}] confidence ${confidence} -> 1 (out of range).`
      );
      confidence = 1;
    } else if (confidence < 0) {
      coercionWarnings.push(
        `Coerced mapping[${idx}] confidence ${confidence} -> 0 (out of range).`
      );
      confidence = 0;
    }

    const out: ColumnMapping = {
      source: m.source,
      target: m.target,
      confidence,
    };
    if (typeof m.transform === "string") out.transform = m.transform;
    if (typeof m.approximate === "boolean") out.approximate = m.approximate;
    if (Array.isArray(m.fuzzy_matches)) {
      out.fuzzy_matches = m.fuzzy_matches.flatMap((fm) => {
        if (
          isPlainObject(fm) &&
          typeof (fm as Record<string, unknown>).source_value === "string" &&
          typeof (fm as Record<string, unknown>).camp_id === "string"
        ) {
          const f = fm as Record<string, unknown>;
          return [
            {
              source_value: f.source_value as string,
              camp_id: f.camp_id as string,
            },
          ];
        }
        return [];
      });
    }
    return out;
  });

  const validatedUnmapped: UnmappedColumn[] = Array.isArray(unmapped)
    ? unmapped.flatMap((u) => {
        if (!isPlainObject(u)) return [];
        const r = u as Record<string, unknown>;
        if (typeof r.source !== "string") return [];
        const samples = Array.isArray(r.samples)
          ? r.samples.map((v) => String(v))
          : [];
        const upsellHint =
          typeof r.upsell_hint === "string" ? r.upsell_hint : "";
        return [{ source: r.source, samples, upsell_hint: upsellHint }];
      })
    : [];

  const validatedWarnings: string[] = Array.isArray(warnings)
    ? warnings.filter((w): w is string => typeof w === "string")
    : [];

  // A1. Duplicate-source guard — the model is explicitly forbidden from
  // emitting the same source column in both `mapping` and `unmapped`, but
  // has been observed doing so. Reject instead of silently letting the
  // downstream pipeline see contradictory intents for one column.
  const mappedSources = new Set(validatedMapping.map((m) => m.source));
  for (const u of validatedUnmapped) {
    if (mappedSources.has(u.source)) {
      throw new AdaptiveImportError(
        `Column '${u.source}' cannot appear in both mapping and unmapped.`,
        rawContext(raw)
      );
    }
  }

  return {
    mapping: validatedMapping,
    unmapped: validatedUnmapped,
    warnings: [...validatedWarnings, ...coercionWarnings],
    row_count,
  };
}

/**
 * A2. Sex-transform referenced-values guard.
 *
 * The system prompt includes a `Manlik→Male; Vroulik→Female` example, and
 * the model has been observed parroting that boilerplate verbatim even
 * when the sample data uses different Afrikaans terms (e.g. `Ooi`/`Ram`).
 * If the proposed transform string does not reference the actual observed
 * values, demote confidence and flag a warning so the commit pipeline
 * re-derives the mapping from data instead of trusting the model's
 * hallucinated rule.
 */
export function checkSexTransformAgainstSamples(
  proposal: MappingProposal,
  sampleRows: Array<Record<string, unknown>>
): MappingProposal {
  const out = {
    ...proposal,
    mapping: [...proposal.mapping],
    warnings: [...proposal.warnings],
  };
  for (let i = 0; i < out.mapping.length; i++) {
    const m = out.mapping[i];
    if (m.target !== "sex" || !m.transform) continue;
    const observed = new Set<string>();
    for (const row of sampleRows) {
      const v = row[m.source];
      if (typeof v === "string" && v.trim()) observed.add(v.trim().toLowerCase());
    }
    if (observed.size === 0) continue;
    const transformLower = m.transform.toLowerCase();
    const unreferenced: string[] = [];
    for (const v of observed) {
      if (!transformLower.includes(v)) unreferenced.push(v);
    }
    if (unreferenced.length > 0) {
      const example = unreferenced[0];
      out.mapping[i] = { ...m, confidence: Math.min(0.5, m.confidence) };
      out.warnings.push(
        `Sex transform may not match observed values (e.g. ${example}); commit pipeline should re-derive from data.`
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sanity-check (Commit B) — dry-run sample values against target-field
// semantics to catch common model hallucinations (e.g. Massa→currentCamp,
// Prys→status observed in live farmer-doc E2E test).
// ---------------------------------------------------------------------------

const SEX_ENUM = new Set([
  "male",
  "female",
  "m",
  "f",
  "ooi",
  "ram",
  "manlik",
  "vroulik",
  "bull",
  "cow",
  "ewe",
]);
const STATUS_ENUM = new Set([
  "active",
  "dead",
  "sold",
  "pregnant",
  "non-pregnant",
  "open",
  "inactive",
  "deceased",
]);
const CURRENCY_RE = /[R$€£¥]/;
const DATE_RE = /^\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}$/;
const MIN_SANE_YEAR = 1900;

function sampleValues(
  row: Record<string, unknown>,
  source: string
): string | undefined {
  const v = row[source];
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function checkValueForTarget(target: string, value: string): boolean {
  switch (target) {
    case "earTag":
    case "sireEarTag":
    case "damEarTag": {
      if (value.length === 0 || value.length > 30) return false;
      if (CURRENCY_RE.test(value)) return false;
      if (DATE_RE.test(value)) return false;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 10000 && !/[A-Za-z\-_]/.test(value))
        return false;
      return true;
    }
    case "birthDate": {
      if (DATE_RE.test(value)) return true;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return false;
      const y = d.getFullYear();
      return y >= MIN_SANE_YEAR && y <= new Date().getFullYear() + 1;
    }
    case "sex":
      return SEX_ENUM.has(value.toLowerCase());
    case "currentCamp":
    case "campId": {
      if (value.length > 40) return false;
      if (CURRENCY_RE.test(value)) return false;
      const n = Number(value);
      // Camp names/IDs almost always contain letters (e.g. "Bergkamp",
      // "Weiveld 1", "bb-c-001"). Pure numerics (e.g. weights 485, 510)
      // are a strong signal the model hallucinated a weight/price column
      // into the camp field.
      if (Number.isFinite(n) && !/[A-Za-z]/.test(value)) return false;
      return true;
    }
    case "status":
      return STATUS_ENUM.has(value.toLowerCase());
    default:
      return true; // unknown target — don't second-guess the model
  }
}

export function sanityCheckMapping(
  proposal: MappingProposal,
  sampleRows: Array<Record<string, unknown>>
): MappingProposal {
  const newMapping: ColumnMapping[] = [];
  const newUnmapped: UnmappedColumn[] = [...proposal.unmapped];
  const newWarnings: string[] = [...proposal.warnings];

  for (const m of proposal.mapping) {
    const samples: string[] = [];
    for (const row of sampleRows) {
      const v = sampleValues(row, m.source);
      if (v !== undefined) samples.push(v);
      if (samples.length >= 3) break;
    }
    if (samples.length === 0) {
      newMapping.push(m);
      continue;
    }
    const failing = samples.filter((v) => !checkValueForTarget(m.target, v));
    const failRate = failing.length / samples.length;
    if (failRate >= 0.5) {
      newUnmapped.push({
        source: m.source,
        samples,
        upsell_hint: `Column values don't match target field '${m.target}' — import may need manual review.`,
      });
      newWarnings.push(
        `Demoted ${m.source}→${m.target}: sample values don't fit target field`
      );
    } else {
      newMapping.push(m);
    }
  }

  return {
    mapping: newMapping,
    unmapped: newUnmapped,
    warnings: newWarnings,
    row_count: proposal.row_count,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rawContext(raw: unknown): { rawResponse?: string } {
  try {
    return { rawResponse: JSON.stringify(raw) };
  } catch {
    return {};
  }
}

export function computeUsage(
  apiUsage: RawApiUsage,
  rates: typeof GPT_4O_MINI_RATES,
  zarPerUsd: number
): ProposalUsage {
  const promptTokens = apiUsage.prompt_tokens ?? 0;
  const completionTokens = apiUsage.completion_tokens ?? 0;
  const cachedTokens = apiUsage.cached_tokens ?? 0;
  const nonCachedInput = Math.max(0, promptTokens - cachedTokens);

  const costUsd =
    (nonCachedInput / 1_000_000) * rates.inputUsdPerMtok +
    (cachedTokens / 1_000_000) * rates.cachedInputUsdPerMtok +
    (completionTokens / 1_000_000) * rates.outputUsdPerMtok;

  return {
    inputTokens: nonCachedInput,
    outputTokens: completionTokens,
    // OpenAI does not charge a distinct cache-creation fee, so the Anthropic
    // concept of "cache creation tokens" collapses to 0 here. Kept in the
    // shape for backwards-compatible telemetry consumers.
    cacheCreationTokens: 0,
    cacheReadTokens: cachedTokens,
    costUsd,
    costZar: costUsd * zarPerUsd,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function proposeColumnMapping(
  input: ProposeMappingInput
): Promise<ProposalResult> {
  validateInput(input);

  const client = getOpenAIClient();
  const userPrompt = buildUserPrompt(input);

  let response;
  try {
    response = await client.chat.completions.create({
      model: MODEL_ID,
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
  } catch (err) {
    throw new AdaptiveImportError("OpenAI API call failed.", { cause: err });
  }

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new AdaptiveImportError(
      "Model response contained no text content.",
      {}
    );
  }

  const parsed = parseProposalJson(text);
  const proposal = validateMappingProposal(parsed);
  const afterSexCheck = checkSexTransformAgainstSamples(
    proposal,
    input.sampleRows
  );
  const sanitized = sanityCheckMapping(afterSexCheck, input.sampleRows);

  const usage = computeUsage(
    {
      prompt_tokens: response.usage?.prompt_tokens ?? 0,
      completion_tokens: response.usage?.completion_tokens ?? 0,
      cached_tokens:
        response.usage?.prompt_tokens_details?.cached_tokens ?? null,
    },
    GPT_4O_MINI_RATES,
    ZAR_PER_USD
  );

  return {
    proposal: sanitized,
    usage,
    model: MODEL_ID,
    promptVersion: SYSTEM_PROMPT_VERSION,
  };
}

function validateInput(input: ProposeMappingInput): void {
  if (!Array.isArray(input.parsedColumns) || input.parsedColumns.length === 0) {
    throw new AdaptiveImportError(
      "parsedColumns must be a non-empty array."
    );
  }
  if (!Array.isArray(input.sampleRows)) {
    throw new AdaptiveImportError("sampleRows must be an array.");
  }
  if (input.sampleRows.length > MAX_SAMPLE_ROWS) {
    throw new AdaptiveImportError(
      `sampleRows must contain at most ${MAX_SAMPLE_ROWS} rows.`
    );
  }
  if (!Array.isArray(input.existingCamps)) {
    throw new AdaptiveImportError("existingCamps must be an array.");
  }
  if (
    typeof input.fullRowCount !== "number" ||
    !Number.isFinite(input.fullRowCount) ||
    input.fullRowCount < 0
  ) {
    throw new AdaptiveImportError(
      "fullRowCount must be a non-negative number."
    );
  }
}
