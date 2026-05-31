/**
 * @vitest-environment node
 *
 * #524 — zod boundary door for the OpenAI breeding-completion response.
 *
 * Mirrors the ADR-0007 (#513) registry door pattern
 * (`lib/domain/observations/details-schemas.ts`): a single boundary module that
 * returns a discriminated `Result` of `{ ok: true, value }` | `{ ok: false,
 * error }`, validates with zod using `.passthrough()` + coercion, and on a
 * malformed/missing inner JSON returns the SAME typed parse error the
 * `breeding/analyze` route currently maps to its 502.
 *
 * Two layers of proof:
 *   1. The door's own contract (pure unit, no Next mocks).
 *   2. Route-level wire-shape preservation — a malformed OpenAI response still
 *      yields the byte-identical legacy 502 `{ error: "Failed to parse AI
 *      response" }`. Mocking mirrors `__tests__/api/breeding-analyze-timeout.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import {
  parseBreedingCompletion,
  BreedingCompletionParseError,
} from "../openai-breeding-door";

// ────────────────────────────────────────────────────────────────────────────
// Route-test mocks (hoisted). The pure door tests below import nothing mocked,
// so these are inert for them.
// ────────────────────────────────────────────────────────────────────────────
const mockGetFarmContextForSlug = vi.fn();
vi.mock("@/lib/server/farm-context-slug", () => ({
  getFarmContextForSlug: (...args: unknown[]) =>
    mockGetFarmContextForSlug(...args),
}));

const mockGetFarmCreds = vi.fn();
vi.mock("@/lib/meta-db", () => ({
  getFarmCreds: (...args: unknown[]) => mockGetFarmCreds(...args),
}));

const mockGetFarmMode = vi.fn();
vi.mock("@/lib/server/get-farm-mode", () => ({
  getFarmMode: (...args: unknown[]) => mockGetFarmMode(...args),
}));

const mockGetBreedingSnapshot = vi.fn();
const mockSuggestPairings = vi.fn();
vi.mock("@/lib/server/breeding-analytics", () => ({
  getBreedingSnapshot: (...args: unknown[]) => mockGetBreedingSnapshot(...args),
  suggestPairings: (...args: unknown[]) => mockSuggestPairings(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ────────────────────────────────────────────────────────────────────────────
// Pure door unit tests.
// ────────────────────────────────────────────────────────────────────────────

/** A realistic OpenAI chat-completion envelope wrapping a valid inner payload. */
function makeCompletion(inner: unknown): unknown {
  return {
    id: "chatcmpl-abc123",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "gpt-4o-2024-08-06",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: typeof inner === "string" ? inner : JSON.stringify(inner),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  };
}

const GOOD_INNER = {
  summary: "Herd is in good shape for the coming season.",
  bullRecommendations: ["Rotate Bull A to camp 3", "Rest Bull B"],
  calvingAlerts: ["3 calvings overdue"],
  breedingWindowSuggestion: "Open the breeding window mid-October.",
  riskFlags: [],
};

describe("parseBreedingCompletion — good payload", () => {
  it("returns ok:true with the typed, parsed inner value", () => {
    const result = parseBreedingCompletion(makeCompletion(GOOD_INNER));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.value.summary).toBe(GOOD_INNER.summary);
    expect(result.value.bullRecommendations).toEqual(
      GOOD_INNER.bullRecommendations,
    );
    expect(result.value.calvingAlerts).toEqual(GOOD_INNER.calvingAlerts);
    expect(result.value.breedingWindowSuggestion).toBe(
      GOOD_INNER.breedingWindowSuggestion,
    );
    expect(result.value.riskFlags).toEqual([]);
  });

  it("defaults a sparse-but-parseable inner object (preserves today's pass-through)", () => {
    // The legacy route cast `JSON.parse(content) as BreedingAIResponse` with no
    // shape check, so a parseable object with missing keys still returned 200.
    // The door preserves that: missing array/string keys default, never reject.
    const result = parseBreedingCompletion(
      makeCompletion({ summary: "only a summary" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.summary).toBe("only a summary");
    expect(result.value.bullRecommendations).toEqual([]);
    expect(result.value.calvingAlerts).toEqual([]);
    expect(result.value.riskFlags).toEqual([]);
    expect(result.value.breedingWindowSuggestion).toBe("");
  });

  it('defaults to an empty inner object when content is the literal "{}"', () => {
    // The route falls back to "{}" when choices[0].message.content is absent.
    const result = parseBreedingCompletion(makeCompletion("{}"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.summary).toBe("");
    expect(result.value.bullRecommendations).toEqual([]);
  });
});

describe("parseBreedingCompletion — coercion", () => {
  it("coerces stringly scalars where the contract asks for strings", () => {
    // Defensive: gpt-4o occasionally emits numbers where strings are asked for.
    const result = parseBreedingCompletion(
      makeCompletion({
        summary: 42,
        bullRecommendations: ["a", "b"],
        breedingWindowSuggestion: 7,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.summary).toBe("42");
    expect(result.value.breedingWindowSuggestion).toBe("7");
  });
});

describe("parseBreedingCompletion — passthrough", () => {
  it("preserves an unknown upstream field on the inner payload", () => {
    const result = parseBreedingCompletion(
      makeCompletion({ ...GOOD_INNER, newUpstreamField: "survives" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect((result.value as Record<string, unknown>).newUpstreamField).toBe(
      "survives",
    );
  });

  it("preserves an unknown upstream field on the outer envelope", () => {
    const completion = makeCompletion(GOOD_INNER) as Record<string, unknown>;
    completion.system_fingerprint = "fp_xyz";
    completion.brandNewEnvelopeField = { nested: true };
    const result = parseBreedingCompletion(completion);
    expect(result.ok).toBe(true);
  });
});

describe("parseBreedingCompletion — bad payload (ok:false + typed error)", () => {
  it("returns ok:false with a typed parse error when inner JSON is malformed", () => {
    const result = parseBreedingCompletion(
      makeCompletion("{ this is not valid json"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(BreedingCompletionParseError);
    expect(result.error.code).toBe("BREEDING_COMPLETION_PARSE_FAILED");
  });

  it("returns ok:false when the inner JSON parses to a non-object (array)", () => {
    // JSON.parse("[]") succeeds today and silently casts to BreedingAIResponse
    // (a latent bug). The door rejects it as a missing required object shape.
    const result = parseBreedingCompletion(makeCompletion("[1,2,3]"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(BreedingCompletionParseError);
  });

  it("returns ok:false when the inner JSON parses to a bare scalar", () => {
    const result = parseBreedingCompletion(makeCompletion("123"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("BREEDING_COMPLETION_PARSE_FAILED");
  });

  it("returns ok:false when the outer envelope has no choices array", () => {
    const result = parseBreedingCompletion({
      id: "x",
      object: "chat.completion",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(BreedingCompletionParseError);
  });

  it("returns ok:false when message.content is not a string", () => {
    const completion = makeCompletion(GOOD_INNER) as {
      choices: Array<{ message: { content: unknown } }>;
    };
    completion.choices[0].message.content = { not: "a string" };
    const result = parseBreedingCompletion(completion);
    expect(result.ok).toBe(false);
  });

  it("carries the underlying zod issues on the typed error for diagnostics", () => {
    const result = parseBreedingCompletion(makeCompletion("[]"));
    if (result.ok) throw new Error("expected failure");
    expect(Array.isArray(result.error.issues)).toBe(true);
    expect(result.error.issues.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Route-level wire-shape preservation — the 502 must stay byte-identical.
// ────────────────────────────────────────────────────────────────────────────
describe("POST /api/[farmSlug]/breeding/analyze — door wire-shape preservation", () => {
  const mockFarmSettingsFindFirst = vi.fn();
  const mockObservationFindMany = vi.fn();
  const mockPrisma = {
    farmSettings: { findFirst: mockFarmSettingsFindFirst },
    observation: { findMany: mockObservationFindMany },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFarmContextForSlug.mockResolvedValue({
      prisma: mockPrisma,
      slug: "delta-livestock",
      role: "admin",
    });
    mockGetFarmCreds.mockResolvedValue({
      slug: "delta-livestock",
      tier: "advanced",
    });
    mockGetFarmMode.mockResolvedValue("cattle");
    mockGetBreedingSnapshot.mockResolvedValue({
      bullsInService: 2,
      pregnantCows: 50,
      openCows: 20,
      expectedCalvingsThisMonth: 5,
      calendarEntries: [],
    });
    mockSuggestPairings.mockResolvedValue({ pairings: [] });
    mockFarmSettingsFindFirst.mockResolvedValue({
      openaiApiKey: "sk-test-key",
      breedingSeasonStart: null,
      breedingSeasonEnd: null,
    });
    mockObservationFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const buildRequest = () =>
    new NextRequest("http://localhost/api/delta-livestock/breeding/analyze", {
      method: "POST",
    });

  const buildParams = () => Promise.resolve({ farmSlug: "delta-livestock" });

  /** Stub fetch with a 200 OpenAI envelope whose inner content is `inner`. */
  function stubOpenAi(inner: string): void {
    const fetchStub = vi.fn(async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: inner } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchStub);
  }

  it("still returns the byte-identical 502 body on malformed inner JSON", async () => {
    stubOpenAi("{ this is not valid json");
    const { POST } = await import(
      "@/app/api/[farmSlug]/breeding/analyze/route"
    );
    const res = await POST(buildRequest(), { params: buildParams() });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body).toEqual({ error: "Failed to parse AI response" });
  });

  it("returns 502 on a non-object inner JSON (array) — door tightens the latent cast", async () => {
    stubOpenAi("[1,2,3]");
    const { POST } = await import(
      "@/app/api/[farmSlug]/breeding/analyze/route"
    );
    const res = await POST(buildRequest(), { params: buildParams() });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body).toEqual({ error: "Failed to parse AI response" });
  });

  it("returns 200 with the parsed payload on a valid OpenAI response", async () => {
    stubOpenAi(
      JSON.stringify({
        summary: "All good",
        bullRecommendations: ["x"],
        calvingAlerts: [],
        breedingWindowSuggestion: "mid-Oct",
        riskFlags: [],
      }),
    );
    const { POST } = await import(
      "@/app/api/[farmSlug]/breeding/analyze/route"
    );
    const res = await POST(buildRequest(), { params: buildParams() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary?: string;
      bullRecommendations?: string[];
    };
    expect(body.summary).toBe("All good");
    expect(body.bullRecommendations).toEqual(["x"]);
  });
});
