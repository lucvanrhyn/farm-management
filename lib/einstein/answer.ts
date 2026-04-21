/**
 * lib/einstein/answer.ts — Phase L Wave 2B Claude Sonnet 4.6 answer generator.
 *
 * Calls Claude Sonnet 4.6 with the Farm Methodology Object + retrieved chunks
 * as system context (cache_control on both — long-lived prefixes reduce cost
 * substantially over many questions). Streams text tokens back to the route
 * handler via an AsyncGenerator; on completion, validates that every citation
 * ID appears in retrieval.chunks[].entityId. Fabricated citations → error.
 *
 * Output contract: the model returns its final answer as JSON at the very end
 * of its response, inside a fenced ```json block. We stream raw tokens back to
 * the user as they arrive (so the UI feels responsive) AND parse the tail JSON
 * once message_stop fires. Any parse / validation failure emits an `error`
 * event and aborts the stream.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_ANSWER_MODEL } from './defaults';
import type { Citation, RetrievalResult } from './retriever';
import type { EinsteinConfidence, EinsteinRefusalReason } from './defaults';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EinsteinAnswer {
  answer: string;
  citations: Citation[];
  confidence: EinsteinConfidence;
  refusedReason?: EinsteinRefusalReason;
}

export type AnswerStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'final'; payload: EinsteinAnswer }
  | { type: 'error'; code: string; message: string };

// ── Typed errors ──────────────────────────────────────────────────────────────

export type AnswerErrorCode =
  | 'EINSTEIN_ANSWER_NO_KEY'
  | 'EINSTEIN_ANSWER_API_ERROR'
  | 'EINSTEIN_ANSWER_INVALID_JSON'
  | 'EINSTEIN_CITATION_FABRICATION';

export class EinsteinAnswerError extends Error {
  readonly code: AnswerErrorCode;
  constructor(code: AnswerErrorCode, message: string) {
    super(message);
    this.name = 'EinsteinAnswerError';
    this.code = code;
  }
}

// ── Lazy client ───────────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new EinsteinAnswerError(
      'EINSTEIN_ANSWER_NO_KEY',
      'ANTHROPIC_API_KEY must be set in environment variables',
    );
  }
  return new Anthropic({ apiKey });
}

// ── System prompt builder ─────────────────────────────────────────────────────

const BASE_INSTRUCTIONS = `You are Einstein (renamable), a livestock farm AI assistant for a South African farmer.

GROUNDING DISCIPLINE:
- Answer ONLY from the retrieved chunks below. If the chunks don't support an answer, refuse with \`refusedReason: "NO_GROUNDED_EVIDENCE"\`.
- Out-of-scope topics (politics, personal finance outside farming, etc) → refuse with \`refusedReason: "OUT_OF_SCOPE"\`.
- Every factual claim MUST have a citation pointing to a chunk actually in the retrieval set. Never invent entityId values.
- If the farmer prefers Afrikaans (or their question is Afrikaans), reply in Afrikaans. Otherwise reply in English.

RESPONSE FORMAT (strict):
Emit a single fenced \`\`\`json block at the end containing:
{
  "answer": "<prose answer — 1-3 short paragraphs max; farmer-friendly; practical>",
  "citations": [
    { "entityType": "...", "entityId": "...", "quote": "short snippet from the chunk", "relevance": "direct" | "supporting" | "contextual" }
  ],
  "confidence": "high" | "medium" | "low",
  "refusedReason": null | "NO_GROUNDED_EVIDENCE" | "OUT_OF_SCOPE" | "TIER_LIMIT"
}

You may write a brief streaming narration before the JSON block, but the FINAL ANSWER the farmer sees is the \`answer\` field inside the JSON. The JSON block MUST appear at the end, wrapped in \`\`\`json ... \`\`\`.`;

function buildMethodologySection(methodology: unknown): string {
  if (!methodology || typeof methodology !== 'object') {
    return 'Farm Methodology Object: (not yet configured)';
  }
  try {
    return `Farm Methodology Object:\n${JSON.stringify(methodology, null, 2)}`;
  } catch {
    return 'Farm Methodology Object: (unserialisable)';
  }
}

function buildRetrievalSection(retrieval: RetrievalResult): string {
  if (retrieval.chunks.length === 0) {
    return 'Retrieved chunks: (none — the farmer\'s DB has no matching data for this query)';
  }
  const lines = retrieval.chunks.map((c, i) => {
    const when = c.sourceUpdatedAt.toISOString().slice(0, 10);
    return `[${i + 1}] entityType=${c.entityType} entityId=${c.entityId} updatedAt=${when} score=${c.score.toFixed(3)}\n    ${c.text}`;
  });
  return `Retrieved chunks (${retrieval.chunks.length} total):\n${lines.join('\n')}`;
}

// ── Streaming generator ───────────────────────────────────────────────────────

export interface StreamAnswerParams {
  question: string;
  assistantName: string;
  methodology: unknown;
  retrieval: RetrievalResult;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function* streamAnswer(
  params: StreamAnswerParams,
): AsyncGenerator<AnswerStreamEvent> {
  const { question, assistantName, methodology, retrieval, history } = params;

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch (err) {
    const e = err as EinsteinAnswerError;
    yield { type: 'error', code: e.code ?? 'EINSTEIN_ANSWER_NO_KEY', message: e.message };
    return;
  }

  // Build prompt caching-friendly system blocks. The instructions +
  // methodology are long-lived per tenant; the retrieval varies per query.
  // Prompt caching via cache_control is supported by the Anthropic API but not
  // always reflected in the SDK's TextBlockParam type (varies by SDK minor).
  // Cast through `unknown` so we opt into the beta shape without bypassing
  // every other field's checking.
  const systemBlocks = [
    {
      type: 'text' as const,
      text: `Assistant name: ${assistantName || 'Einstein'}\n\n${BASE_INSTRUCTIONS}`,
      cache_control: { type: 'ephemeral' as const },
    },
    {
      type: 'text' as const,
      text: buildMethodologySection(methodology),
      cache_control: { type: 'ephemeral' as const },
    },
    {
      type: 'text' as const,
      text: buildRetrievalSection(retrieval),
    },
  ] as unknown as Anthropic.TextBlockParam[];

  const messages: Anthropic.MessageParam[] = [];
  if (history && history.length > 0) {
    for (const turn of history) {
      if (turn.role === 'user' || turn.role === 'assistant') {
        messages.push({ role: turn.role, content: turn.content });
      }
    }
  }
  messages.push({ role: 'user', content: question });

  let fullText = '';

  try {
    const stream = client.messages.stream({
      model: ANTHROPIC_ANSWER_MODEL,
      max_tokens: 1200,
      system: systemBlocks,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta &&
        'type' in event.delta &&
        event.delta.type === 'text_delta'
      ) {
        const delta = event.delta.text;
        fullText += delta;
        yield { type: 'token', text: delta };
      }
    }
  } catch (err) {
    yield {
      type: 'error',
      code: 'EINSTEIN_ANSWER_API_ERROR',
      message: err instanceof Error ? err.message : 'Anthropic streaming call failed',
    };
    return;
  }

  // Parse the tail JSON block.
  let parsed: EinsteinAnswer;
  try {
    parsed = parseAnswerJson(fullText);
  } catch (err) {
    yield {
      type: 'error',
      code: 'EINSTEIN_ANSWER_INVALID_JSON',
      message: err instanceof Error ? err.message : 'invalid JSON in answer tail',
    };
    return;
  }

  // Citation validation — every entityId MUST appear in retrieval.chunks.
  const validIds = new Set(retrieval.chunks.map((c) => c.entityId));
  const fabricated = parsed.citations.filter((cit) => !validIds.has(cit.entityId));
  if (fabricated.length > 0 && !parsed.refusedReason) {
    yield {
      type: 'error',
      code: 'EINSTEIN_CITATION_FABRICATION',
      message: `Model cited ${fabricated.length} entityId(s) not in retrieval set: ${fabricated
        .map((c) => c.entityId)
        .join(', ')}`,
    };
    return;
  }

  yield { type: 'final', payload: parsed };
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export function parseAnswerJson(raw: string): EinsteinAnswer {
  // Locate the final ```json block.
  const blockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  let jsonStr: string;
  if (blockMatch) {
    jsonStr = blockMatch[1].trim();
  } else {
    // No fence — try parsing the tail as raw JSON (trimmed).
    jsonStr = raw.trim();
  }

  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    throw new EinsteinAnswerError(
      'EINSTEIN_ANSWER_INVALID_JSON',
      'Answer did not contain a parseable JSON block',
    );
  }

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new EinsteinAnswerError(
      'EINSTEIN_ANSWER_INVALID_JSON',
      'Answer JSON must be an object',
    );
  }
  const record = obj as Record<string, unknown>;

  if (typeof record.answer !== 'string') {
    throw new EinsteinAnswerError(
      'EINSTEIN_ANSWER_INVALID_JSON',
      'answer field must be a string',
    );
  }
  if (!Array.isArray(record.citations)) {
    throw new EinsteinAnswerError(
      'EINSTEIN_ANSWER_INVALID_JSON',
      'citations field must be an array',
    );
  }
  const conf = record.confidence;
  if (conf !== 'high' && conf !== 'medium' && conf !== 'low') {
    throw new EinsteinAnswerError(
      'EINSTEIN_ANSWER_INVALID_JSON',
      'confidence field must be "high" | "medium" | "low"',
    );
  }

  const citations: Citation[] = record.citations
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c): Citation => {
      const relevance: Citation['relevance'] =
        c.relevance === 'direct' || c.relevance === 'supporting' || c.relevance === 'contextual'
          ? c.relevance
          : 'contextual';
      return {
        entityType: (c.entityType as Citation['entityType']) ?? 'observation',
        entityId: String(c.entityId ?? ''),
        quote: String(c.quote ?? ''),
        relevance,
      };
    })
    .filter((c) => c.entityId.length > 0);

  const refusedReason =
    record.refusedReason === 'NO_GROUNDED_EVIDENCE' ||
    record.refusedReason === 'OUT_OF_SCOPE' ||
    record.refusedReason === 'TIER_LIMIT'
      ? record.refusedReason
      : undefined;

  return {
    answer: record.answer,
    citations,
    confidence: conf,
    refusedReason,
  };
}
