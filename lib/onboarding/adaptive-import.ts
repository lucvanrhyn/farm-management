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

  return {
    mapping: validatedMapping,
    unmapped: validatedUnmapped,
    warnings: [...validatedWarnings, ...coercionWarnings],
    row_count,
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
    proposal,
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
