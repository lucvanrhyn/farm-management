/**
 * lib/einstein/embeddings.ts
 *
 * Lazy-instantiated OpenAI embeddings client with batching, typed errors,
 * and ZAR cost helpers.
 *
 * Design rules:
 * - NEVER read process.env at module scope — only inside functions (lazy).
 * - Batch inputs in slices of BATCH_SIZE (OpenAI max per call).
 * - Aggregate usage across all batches.
 * - Map known failure modes to typed EmbeddingError codes.
 * - embeddingToBytes / bytesToEmbedding use little-endian Float32 packing
 *   for compatibility with libSQL F32_BLOB storage.
 */

import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const ZAR_PER_USD = 18.5;

/** OpenAI maximum input texts per embeddings API call. */
const BATCH_SIZE = 2048;

/** Cost per token in USD: $0.02 per 1M tokens. */
const COST_USD_PER_TOKEN = 0.02 / 1_000_000;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type EmbeddingErrorCode =
  | "EMBEDDING_NO_KEY"
  | "EMBEDDING_RATE_LIMIT"
  | "EMBEDDING_INVALID_RESPONSE"
  | "EMBEDDING_NETWORK";

export class EmbeddingError extends Error {
  code: EmbeddingErrorCode;
  cause?: unknown;

  constructor(code: EmbeddingErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "EmbeddingError";
    this.code = code;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface EmbedUsage {
  promptTokens: number;
  totalTokens: number;
  costUsd: number;
  costZar: number;
}

export interface EmbedResult {
  /** One Float32Array per input text, in the same order as the input array. */
  vectors: Float32Array[];
  usage: EmbedUsage;
  /** e.g. 'text-embedding-3-small' */
  modelId: string;
}

// ---------------------------------------------------------------------------
// Lazy client (mirrors lib/onboarding/adaptive-import.ts:139-146)
// ---------------------------------------------------------------------------

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError(
      "EMBEDDING_NO_KEY",
      "OPENAI_API_KEY must be set in environment variables."
    );
  }
  return new OpenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Slice an array into chunks of at most `size`. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/** Wrap an unknown thrown value into a typed EmbeddingError. */
function mapError(err: unknown): EmbeddingError {
  if (err instanceof EmbeddingError) return err;

  // OpenAI SDK surfaces HTTP status on thrown errors
  if (
    err !== null &&
    typeof err === "object" &&
    "status" in err &&
    (err as { status: number }).status === 429
  ) {
    return new EmbeddingError(
      "EMBEDDING_RATE_LIMIT",
      "OpenAI rate limit exceeded.",
      err
    );
  }

  return new EmbeddingError(
    "EMBEDDING_NETWORK",
    err instanceof Error ? err.message : "Unknown embedding network error.",
    err
  );
}

// ---------------------------------------------------------------------------
// Core embed function
// ---------------------------------------------------------------------------

/**
 * Embed an array of text strings using OpenAI text-embedding-3-small.
 *
 * Batches inputs into slices of 2048 (OpenAI limit), calls the API
 * sequentially to avoid rate-limit bursts, and aggregates results in order.
 *
 * Throws EmbeddingError on known failure modes.
 */
export async function embed(texts: string[]): Promise<EmbedResult> {
  const client = getOpenAIClient(); // throws EMBEDDING_NO_KEY if missing

  const batches = chunkArray(texts, BATCH_SIZE);
  const allVectors: Float32Array[] = [];
  let totalPromptTokens = 0;
  let totalTokens = 0;
  let modelId = EMBEDDING_MODEL;

  for (const batch of batches) {
    let response: Awaited<ReturnType<typeof client.embeddings.create>>;

    try {
      response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
      });
    } catch (err) {
      throw mapError(err);
    }

    // Validate response shape
    if (
      !response.data ||
      !Array.isArray(response.data) ||
      response.data.length !== batch.length
    ) {
      throw new EmbeddingError(
        "EMBEDDING_INVALID_RESPONSE",
        `Expected ${batch.length} embeddings, got ${response.data?.length ?? "undefined"}.`
      );
    }

    // Convert to Float32Array in index order (API may not return sorted)
    for (let i = 0; i < batch.length; i++) {
      const item = response.data[i];
      allVectors.push(new Float32Array(item.embedding));
    }

    totalPromptTokens += response.usage?.prompt_tokens ?? 0;
    totalTokens += response.usage?.total_tokens ?? 0;
    if (response.model) modelId = response.model;
  }

  const costUsd = totalTokens * COST_USD_PER_TOKEN;

  return {
    vectors: allVectors,
    usage: {
      promptTokens: totalPromptTokens,
      totalTokens,
      costUsd,
      costZar: costUsd * ZAR_PER_USD,
    },
    modelId,
  };
}

// ---------------------------------------------------------------------------
// Binary encoding helpers (little-endian Float32, for libSQL F32_BLOB)
// ---------------------------------------------------------------------------

/**
 * Convert a Float32Array to a Buffer using little-endian IEEE 754 packing.
 * Ready for direct storage as a libSQL F32_BLOB column.
 */
export function embeddingToBytes(v: Float32Array): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) {
    buf.writeFloatLE(v[i], i * 4);
  }
  return buf;
}

/**
 * Decode a little-endian Float32 Buffer back to a Float32Array.
 * Inverse of embeddingToBytes.
 */
export function bytesToEmbedding(b: Buffer): Float32Array {
  const count = b.length / 4;
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    result[i] = b.readFloatLE(i * 4);
  }
  return result;
}
