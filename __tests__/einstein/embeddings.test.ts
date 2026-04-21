/**
 * @vitest-environment node
 *
 * __tests__/einstein/embeddings.test.ts
 *
 * Unit tests for lib/einstein/embeddings.ts.
 * All external calls (OpenAI SDK) are mocked — no network required.
 *
 * Pattern: vi.doMock (not vi.mock — avoids hoisting issues inside describe blocks)
 * + vi.resetModules() + dynamic import to get a fresh module per test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal OpenAI embedding API response payload. */
function makeOpenAIResponse(
  count: number,
  promptTokens = 10,
  totalTokens = 12
) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      embedding: Array.from({ length: 1536 }, (_, j) => (i + j) * 0.001),
      index: i,
      object: "embedding",
    })),
    model: "text-embedding-3-small",
    object: "list",
    usage: {
      prompt_tokens: promptTokens,
      total_tokens: totalTokens,
    },
  };
}

/** Load a fresh copy of the embeddings module with the given mock for openai. */
async function loadWithMock(createFn: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  // OpenAI is used as `new OpenAI(...)` — the mock default export must be a
  // constructor (a real function, not an arrow function).
  vi.doMock("openai", () => {
    function MockOpenAI() {
      return { embeddings: { create: createFn } };
    }
    return { default: MockOpenAI };
  });
  return import("@/lib/einstein/embeddings");
}

// ---------------------------------------------------------------------------
// 1. Missing API key
// ---------------------------------------------------------------------------

describe("embed — missing API key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws EmbeddingError with code EMBEDDING_NO_KEY when OPENAI_API_KEY is empty string", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.resetModules();
    const { embed, EmbeddingError } = await import("@/lib/einstein/embeddings");

    const thrown = await embed(["hello"]).catch((e) => e);
    expect(thrown).toBeInstanceOf(EmbeddingError);
    expect(thrown.code).toBe("EMBEDDING_NO_KEY");
  });

  it("throws EmbeddingError with code EMBEDDING_NO_KEY when OPENAI_API_KEY is undefined", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.resetModules();
    const { embed, EmbeddingError } = await import("@/lib/einstein/embeddings");

    await expect(embed(["hello"])).rejects.toBeInstanceOf(EmbeddingError);
    await expect(embed(["hello"])).rejects.toMatchObject({
      code: "EMBEDDING_NO_KEY",
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path
// ---------------------------------------------------------------------------

describe("embed — happy path", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns vectors in the same order as input texts", async () => {
    const texts = ["first", "second", "third"];
    const createFn = vi.fn().mockResolvedValue(makeOpenAIResponse(3, 30, 36));
    const { embed } = await loadWithMock(createFn);

    const result = await embed(texts);

    expect(result.vectors).toHaveLength(3);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(result.vectors[0].length).toBe(1536);
  });

  it("reports correct usage fields including ZAR conversion", async () => {
    const createFn = vi.fn().mockResolvedValue(makeOpenAIResponse(2, 20, 24));
    const { embed, ZAR_PER_USD } = await loadWithMock(createFn);

    const result = await embed(["alpha", "beta"]);

    expect(result.usage.promptTokens).toBe(20);
    expect(result.usage.totalTokens).toBe(24);

    const expectedCostUsd = (24 / 1_000_000) * 0.02;
    expect(result.usage.costUsd).toBeCloseTo(expectedCostUsd, 10);
    expect(result.usage.costZar).toBeCloseTo(expectedCostUsd * ZAR_PER_USD, 10);
  });

  it("returns the correct modelId", async () => {
    const createFn = vi.fn().mockResolvedValue(makeOpenAIResponse(1));
    const { embed, EMBEDDING_MODEL } = await loadWithMock(createFn);

    const result = await embed(["test"]);
    expect(result.modelId).toBe(EMBEDDING_MODEL);
  });

  it("calls the SDK with the correct model and input array", async () => {
    const texts = ["dog", "cat"];
    const createFn = vi.fn().mockResolvedValue(makeOpenAIResponse(2));
    const { embed, EMBEDDING_MODEL } = await loadWithMock(createFn);

    await embed(texts);

    expect(createFn).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: texts,
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Batching (2500 inputs → two calls)
// ---------------------------------------------------------------------------

describe("embed — batching (2500 inputs → two calls)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("splits 2500 texts into two SDK calls (2048 + 452)", async () => {
    const texts = Array.from({ length: 2500 }, (_, i) => `text-${i}`);

    const createFn = vi
      .fn()
      .mockResolvedValueOnce(makeOpenAIResponse(2048, 2048, 2500))
      .mockResolvedValueOnce(makeOpenAIResponse(452, 452, 500));

    const { embed } = await loadWithMock(createFn);
    const result = await embed(texts);

    expect(createFn).toHaveBeenCalledTimes(2);
    expect(createFn.mock.calls[0][0].input).toHaveLength(2048);
    expect(createFn.mock.calls[1][0].input).toHaveLength(452);
    expect(result.vectors).toHaveLength(2500);
  });

  it("preserves order of vectors across batches", async () => {
    const texts = Array.from({ length: 2500 }, (_, i) => `text-${i}`);

    // Batch 1: vectors where all components = globalIndex * 0.001
    const batch1Data = Array.from({ length: 2048 }, (_, i) => ({
      embedding: Array.from({ length: 1536 }, () => i * 0.001),
      index: i,
      object: "embedding",
    }));
    // Batch 2: vectors where all components = (2048 + localIndex) * 0.001
    const batch2Data = Array.from({ length: 452 }, (_, i) => ({
      embedding: Array.from({ length: 1536 }, () => (2048 + i) * 0.001),
      index: i,
      object: "embedding",
    }));

    const createFn = vi
      .fn()
      .mockResolvedValueOnce({
        data: batch1Data,
        model: "text-embedding-3-small",
        object: "list",
        usage: { prompt_tokens: 2048, total_tokens: 2500 },
      })
      .mockResolvedValueOnce({
        data: batch2Data,
        model: "text-embedding-3-small",
        object: "list",
        usage: { prompt_tokens: 452, total_tokens: 500 },
      });

    const { embed } = await loadWithMock(createFn);
    const result = await embed(texts);

    expect(result.vectors).toHaveLength(2500);
    // First vector: all values = 0 * 0.001 = 0
    expect(result.vectors[0][0]).toBeCloseTo(0, 5);
    // Vector at index 100: all values = 100 * 0.001 = 0.1
    expect(result.vectors[100][0]).toBeCloseTo(0.1, 4);
    // Vector at index 2048 (first of batch 2): all values = 2048 * 0.001
    expect(result.vectors[2048][0]).toBeCloseTo(2048 * 0.001, 3);
  });

  it("sums usage across batches", async () => {
    const texts = Array.from({ length: 2500 }, (_, i) => `text-${i}`);

    const createFn = vi
      .fn()
      .mockResolvedValueOnce(makeOpenAIResponse(2048, 2048, 2500))
      .mockResolvedValueOnce(makeOpenAIResponse(452, 452, 500));

    const { embed } = await loadWithMock(createFn);
    const result = await embed(texts);

    expect(result.usage.promptTokens).toBe(2048 + 452);
    expect(result.usage.totalTokens).toBe(2500 + 500);
  });
});

// ---------------------------------------------------------------------------
// 4. Error handling
// ---------------------------------------------------------------------------

describe("embed — error handling", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws EMBEDDING_INVALID_RESPONSE when response has no data field", async () => {
    const malformed = {
      // no 'data' field
      model: "text-embedding-3-small",
      object: "list",
      usage: { prompt_tokens: 5, total_tokens: 5 },
    };
    const createFn = vi.fn().mockResolvedValue(malformed);
    const { embed, EmbeddingError } = await loadWithMock(createFn);

    const thrown = await embed(["hello"]).catch((e) => e);
    expect(thrown).toBeInstanceOf(EmbeddingError);
    expect(thrown.code).toBe("EMBEDDING_INVALID_RESPONSE");
  });

  it("throws EMBEDDING_INVALID_RESPONSE when data length mismatches input length", async () => {
    const mismatch = {
      data: [
        // Only 2 items for 3 inputs
        { embedding: new Array(1536).fill(0.1), index: 0, object: "embedding" },
        { embedding: new Array(1536).fill(0.2), index: 1, object: "embedding" },
      ],
      model: "text-embedding-3-small",
      object: "list",
      usage: { prompt_tokens: 10, total_tokens: 12 },
    };
    const createFn = vi.fn().mockResolvedValue(mismatch);
    const { embed, EmbeddingError } = await loadWithMock(createFn);

    const thrown = await embed(["one", "two", "three"]).catch((e) => e);
    expect(thrown).toBeInstanceOf(EmbeddingError);
    expect(thrown.code).toBe("EMBEDDING_INVALID_RESPONSE");
  });

  it("throws EMBEDDING_RATE_LIMIT on 429 status error", async () => {
    const rateLimitErr = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
    });
    const createFn = vi.fn().mockRejectedValue(rateLimitErr);
    const { embed, EmbeddingError } = await loadWithMock(createFn);

    const thrown = await embed(["hello"]).catch((e) => e);
    expect(thrown).toBeInstanceOf(EmbeddingError);
    expect(thrown.code).toBe("EMBEDDING_RATE_LIMIT");
  });

  it("throws EMBEDDING_NETWORK for unknown errors", async () => {
    const networkErr = new Error("ECONNRESET");
    const createFn = vi.fn().mockRejectedValue(networkErr);
    const { embed, EmbeddingError } = await loadWithMock(createFn);

    const thrown = await embed(["hello"]).catch((e) => e);
    expect(thrown).toBeInstanceOf(EmbeddingError);
    expect(thrown.code).toBe("EMBEDDING_NETWORK");
  });

  it("EMBEDDING_NETWORK error preserves original cause", async () => {
    const originalError = new Error("socket hang up");
    const createFn = vi.fn().mockRejectedValue(originalError);
    const { embed } = await loadWithMock(createFn);

    const thrown = await embed(["hello"]).catch((e) => e);
    expect(thrown.cause).toBe(originalError);
  });
});

// ---------------------------------------------------------------------------
// 5. embeddingToBytes / bytesToEmbedding — round-trip
// ---------------------------------------------------------------------------

describe("embeddingToBytes / bytesToEmbedding — round-trip", () => {
  it("converts Float32Array to Buffer and back preserving values within Float32 precision", async () => {
    vi.resetModules();
    const { embeddingToBytes, bytesToEmbedding, EMBEDDING_DIMENSIONS } =
      await import("@/lib/einstein/embeddings");

    const original = new Float32Array(EMBEDDING_DIMENSIONS);
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      original[i] = Math.fround(Math.sin(i * 0.01));
    }

    const buf = embeddingToBytes(original);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(EMBEDDING_DIMENSIONS * 4);

    const recovered = bytesToEmbedding(buf);
    expect(recovered).toBeInstanceOf(Float32Array);
    expect(recovered.length).toBe(EMBEDDING_DIMENSIONS);

    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      expect(recovered[i]).toBeCloseTo(original[i], 6);
    }
  });

  it("empty Float32Array round-trips correctly", async () => {
    vi.resetModules();
    const { embeddingToBytes, bytesToEmbedding } = await import(
      "@/lib/einstein/embeddings"
    );

    const empty = new Float32Array(0);
    const buf = embeddingToBytes(empty);
    expect(buf.length).toBe(0);

    const recovered = bytesToEmbedding(buf);
    expect(recovered.length).toBe(0);
  });

  it("single-element Float32Array round-trips correctly", async () => {
    vi.resetModules();
    const { embeddingToBytes, bytesToEmbedding } = await import(
      "@/lib/einstein/embeddings"
    );

    const single = new Float32Array([Math.fround(3.14159)]);
    const buf = embeddingToBytes(single);
    expect(buf.length).toBe(4);

    const recovered = bytesToEmbedding(buf);
    expect(recovered[0]).toBeCloseTo(Math.fround(3.14159), 5);
  });

  it("uses little-endian byte order — Float32(1.0) = 0x00 0x00 0x80 0x3F", async () => {
    vi.resetModules();
    const { embeddingToBytes } = await import("@/lib/einstein/embeddings");

    const v = new Float32Array([1.0]);
    const buf = embeddingToBytes(v);
    expect(buf[0]).toBe(0x00);
    expect(buf[1]).toBe(0x00);
    expect(buf[2]).toBe(0x80);
    expect(buf[3]).toBe(0x3f);
  });
});

// ---------------------------------------------------------------------------
// 6. Constants
// ---------------------------------------------------------------------------

describe("exported constants", () => {
  it("ZAR_PER_USD is 18.5", async () => {
    vi.resetModules();
    const { ZAR_PER_USD } = await import("@/lib/einstein/embeddings");
    expect(ZAR_PER_USD).toBe(18.5);
  });

  it("EMBEDDING_DIMENSIONS is 1536", async () => {
    vi.resetModules();
    const { EMBEDDING_DIMENSIONS } = await import("@/lib/einstein/embeddings");
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it("EMBEDDING_MODEL is text-embedding-3-small", async () => {
    vi.resetModules();
    const { EMBEDDING_MODEL } = await import("@/lib/einstein/embeddings");
    expect(EMBEDDING_MODEL).toBe("text-embedding-3-small");
  });
});
