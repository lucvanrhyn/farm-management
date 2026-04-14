import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } from "@/lib/onboarding/schema-dictionary";

// The SDK is hoisted-mocked below. We import the module-under-test AFTER
// the mock so the mocked Anthropic constructor is in place.

const messagesCreateMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: messagesCreateMock };
    constructor(_opts?: { apiKey?: string }) {}
  }
  return { default: MockAnthropic };
});

import {
  proposeColumnMapping,
  buildUserPrompt,
  parseProposalJson,
  validateMappingProposal,
  computeUsage,
  AdaptiveImportError,
  SONNET_4_6_RATES,
  ZAR_PER_USD,
  type ProposeMappingInput,
  type MappingProposal,
} from "@/lib/onboarding/adaptive-import";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const bassonInput: ProposeMappingInput = {
  parsedColumns: [
    "Oormerk",
    "Geslag",
    "Geboorte",
    "Kamp",
    "Ras",
    "Moeder",
    "Pa",
    "Status",
    "Semen kode",
  ],
  sampleRows: [
    {
      Oormerk: "BB-C001",
      Geslag: "Vroulik",
      Geboorte: "14/03/2019",
      Kamp: "Bergkamp",
      Ras: "Bonsmara",
      Moeder: "BB-C088",
      Pa: "Van Aswegen 2023",
      Status: "Aktief",
      "Semen kode": "SK-2019-42",
    },
  ],
  existingCamps: [
    { campId: "bergkamp", campName: "Bergkamp", sizeHectares: 42.5 },
    { campId: "weiveld-1", campName: "Weiveld 1", sizeHectares: 18 },
  ],
  fullRowCount: 103,
};

const happyPathProposal: MappingProposal = {
  mapping: [
    { source: "Oormerk", target: "earTag", confidence: 0.98 },
    {
      source: "Geslag",
      target: "sex",
      confidence: 0.94,
      transform: "Manlik->Male; Vroulik->Female",
    },
    {
      source: "Geboorte",
      target: "dateOfBirth",
      confidence: 0.82,
      transform: "DD/MM/YYYY",
    },
    {
      source: "Kamp",
      target: "currentCamp",
      confidence: 0.92,
      fuzzy_matches: [{ source_value: "Bergkamp", camp_id: "bergkamp" }],
    },
    { source: "Ras", target: "breed", confidence: 0.88 },
    { source: "Moeder", target: "motherId", confidence: 0.9 },
    { source: "Pa", target: "fatherId", confidence: 0.87 },
    { source: "Status", target: "status", confidence: 0.9 },
  ],
  unmapped: [
    {
      source: "Semen kode",
      samples: ["SK-2019-42"],
      upsell_hint: "semen lot tracking",
    },
  ],
  warnings: [
    "Column 'Pa' references sires not in this file — two-pass resolve or text note",
  ],
  row_count: 103,
};

function mockSdkResponse(
  json: unknown,
  usage: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  }> = {}
) {
  messagesCreateMock.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(json) }],
    usage: {
      input_tokens: 800,
      output_tokens: 1500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 5000,
      ...usage,
    },
  });
}

// ---------------------------------------------------------------------------
// Env var isolation
// ---------------------------------------------------------------------------

const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  envBackup.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-DO-NOT-USE";
  messagesCreateMock.mockReset();
});

afterEach(() => {
  if (envBackup.ANTHROPIC_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = envBackup.ANTHROPIC_API_KEY;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proposeColumnMapping — environment", () => {
  it("throws AdaptiveImportError when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(proposeColumnMapping(bassonInput)).rejects.toBeInstanceOf(
      AdaptiveImportError
    );
  });
});

describe("proposeColumnMapping — happy path", () => {
  it("returns a validated ProposalResult for a well-formed response", async () => {
    mockSdkResponse(happyPathProposal);
    const result = await proposeColumnMapping(bassonInput);

    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.promptVersion).toBe(SYSTEM_PROMPT_VERSION);
    expect(result.proposal.row_count).toBe(103);
    expect(result.proposal.mapping).toHaveLength(8);
    expect(result.proposal.unmapped).toHaveLength(1);
    expect(result.usage.inputTokens).toBe(800);
    expect(result.usage.cacheReadTokens).toBe(5000);
    expect(result.usage.costZar).toBeGreaterThan(0);
  });

  it("calls the SDK with cache_control ephemeral on the system block", async () => {
    mockSdkResponse(happyPathProposal);
    await proposeColumnMapping(bassonInput);

    expect(messagesCreateMock).toHaveBeenCalledTimes(1);
    const call = messagesCreateMock.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-4-6");
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0].type).toBe("text");
    expect(call.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("sends SYSTEM_PROMPT verbatim as the cached system block", async () => {
    mockSdkResponse(happyPathProposal);
    await proposeColumnMapping(bassonInput);

    const call = messagesCreateMock.mock.calls[0][0];
    expect(call.system[0].text).toBe(SYSTEM_PROMPT);
  });

  it("keeps per-request data in the user prompt, not the system block", async () => {
    mockSdkResponse(happyPathProposal);
    await proposeColumnMapping(bassonInput);

    // The previous test already pins `call.system[0].text === SYSTEM_PROMPT`,
    // so we know per-request data is not in the system block by construction.
    // Here we just assert the user block carries the farm-specific payload.
    const call = messagesCreateMock.mock.calls[0][0];
    const userMsg = call.messages[0].content;
    const userText = typeof userMsg === "string" ? userMsg : userMsg[0].text;
    expect(userText).toContain("Oormerk");
    expect(userText).toContain("Bergkamp");
    expect(userText).toContain("BB-C001");
    expect(userText).toContain("103");
    // guard against accidentally duplicating the system prompt into the user block
    expect(userText).not.toContain("You are the FarmTrack AI Import Wizard");
  });
});

describe("proposeColumnMapping — input validation", () => {
  it("rejects zero-column input", async () => {
    await expect(
      proposeColumnMapping({ ...bassonInput, parsedColumns: [] })
    ).rejects.toBeInstanceOf(AdaptiveImportError);
  });

  it("rejects more than 20 sample rows", async () => {
    const tooMany = Array.from({ length: 21 }, () => ({ Oormerk: "x" }));
    await expect(
      proposeColumnMapping({ ...bassonInput, sampleRows: tooMany })
    ).rejects.toBeInstanceOf(AdaptiveImportError);
  });
});

describe("buildUserPrompt", () => {
  it("renders a deterministic string for a fixed input", () => {
    const first = buildUserPrompt(bassonInput);
    const second = buildUserPrompt(bassonInput);
    expect(first).toBe(second);
    expect(first).toContain("Columns (9):");
    expect(first).toContain("Oormerk");
    expect(first).toContain("Row count: 103");
    expect(first).toContain("Existing camps (2):");
    expect(first).toContain("bergkamp");
  });

  it("handles empty camp list gracefully", () => {
    const out = buildUserPrompt({ ...bassonInput, existingCamps: [] });
    expect(out).toContain("Existing camps (0): none");
  });
});

describe("parseProposalJson", () => {
  it("parses clean JSON", () => {
    const raw = JSON.stringify(happyPathProposal);
    const parsed = parseProposalJson(raw);
    expect((parsed as MappingProposal).row_count).toBe(103);
  });

  it("strips ```json fences before parsing", () => {
    const raw = "```json\n" + JSON.stringify(happyPathProposal) + "\n```";
    const parsed = parseProposalJson(raw);
    expect((parsed as MappingProposal).row_count).toBe(103);
  });

  it("strips bare ``` fences before parsing", () => {
    const raw = "```\n" + JSON.stringify(happyPathProposal) + "\n```";
    const parsed = parseProposalJson(raw);
    expect((parsed as MappingProposal).row_count).toBe(103);
  });

  it("throws AdaptiveImportError on prose-only output with rawResponse attached", () => {
    const raw = "I'm sorry, I cannot help with that request.";
    try {
      parseProposalJson(raw);
      expect.unreachable("parseProposalJson should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AdaptiveImportError);
      expect((err as AdaptiveImportError).rawResponse).toBe(raw);
    }
  });
});

describe("validateMappingProposal", () => {
  it("accepts a valid proposal unchanged", () => {
    const out = validateMappingProposal(
      JSON.parse(JSON.stringify(happyPathProposal))
    );
    expect(out.mapping).toHaveLength(8);
    expect(out.row_count).toBe(103);
  });

  it("rejects missing mapping array", () => {
    expect(() =>
      validateMappingProposal({
        unmapped: [],
        warnings: [],
        row_count: 0,
      })
    ).toThrow(AdaptiveImportError);
  });

  it("rejects non-numeric row_count", () => {
    expect(() =>
      validateMappingProposal({
        mapping: [],
        unmapped: [],
        warnings: [],
        row_count: "lots",
      })
    ).toThrow(AdaptiveImportError);
  });

  it("rejects non-string source/target in a mapping entry", () => {
    expect(() =>
      validateMappingProposal({
        mapping: [{ source: 42, target: "earTag", confidence: 0.9 }],
        unmapped: [],
        warnings: [],
        row_count: 1,
      })
    ).toThrow(AdaptiveImportError);
  });

  it("coerces confidence above 1 down to 1 and appends a warning", () => {
    const out = validateMappingProposal({
      mapping: [{ source: "Oormerk", target: "earTag", confidence: 1.5 }],
      unmapped: [],
      warnings: [],
      row_count: 1,
    });
    expect(out.mapping[0].confidence).toBe(1);
    expect(out.warnings.some((w) => w.includes("confidence"))).toBe(true);
  });

  it("coerces negative confidence up to 0 and appends a warning", () => {
    const out = validateMappingProposal({
      mapping: [{ source: "Oormerk", target: "earTag", confidence: -0.1 }],
      unmapped: [],
      warnings: [],
      row_count: 1,
    });
    expect(out.mapping[0].confidence).toBe(0);
    expect(out.warnings.some((w) => w.includes("confidence"))).toBe(true);
  });
});

describe("computeUsage — cost math", () => {
  it("computes cache-write path cost for fresh cache entry", () => {
    const usage = computeUsage(
      {
        input_tokens: 800,
        output_tokens: 1500,
        cache_creation_input_tokens: 5000,
        cache_read_input_tokens: 0,
      },
      SONNET_4_6_RATES,
      ZAR_PER_USD
    );
    // input: 800/1M * 3 = 0.0024
    // output: 1500/1M * 15 = 0.0225
    // cache create: 5000/1M * 3.75 = 0.01875
    // total ≈ 0.04365
    expect(usage.costUsd).toBeCloseTo(0.04365, 4);
    expect(usage.costZar).toBeCloseTo(0.04365 * ZAR_PER_USD, 4);
    expect(usage.inputTokens).toBe(800);
    expect(usage.outputTokens).toBe(1500);
    expect(usage.cacheCreationTokens).toBe(5000);
    expect(usage.cacheReadTokens).toBe(0);
  });

  it("computes cache-hit path cost ~R0.55 matching the master plan target", () => {
    const usage = computeUsage(
      {
        input_tokens: 800,
        output_tokens: 1500,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 5000,
      },
      SONNET_4_6_RATES,
      ZAR_PER_USD
    );
    // input: 0.0024
    // output: 0.0225
    // cache read: 5000/1M * 0.30 = 0.0015
    // total ≈ 0.0264 USD ≈ R0.49
    expect(usage.costUsd).toBeCloseTo(0.0264, 4);
    expect(usage.costZar).toBeLessThan(0.6);
    expect(usage.costZar).toBeGreaterThan(0.3);
  });

  it("handles null cache fields defensively", () => {
    const usage = computeUsage(
      {
        input_tokens: 100,
        output_tokens: 100,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
      SONNET_4_6_RATES,
      ZAR_PER_USD
    );
    expect(usage.cacheCreationTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(0);
    expect(usage.costUsd).toBeCloseTo(0.0003 + 0.0015, 5);
  });
});

describe("round-trip — proposal survives JSON serialization", () => {
  it("validated proposal can round-trip through JSON unchanged", () => {
    const a = validateMappingProposal(
      JSON.parse(JSON.stringify(happyPathProposal))
    );
    const b = validateMappingProposal(JSON.parse(JSON.stringify(a)));
    expect(b).toEqual(a);
  });
});

describe("AdaptiveImportError — rawResponse survives catch", () => {
  it("preserves rawResponse across a catch boundary", () => {
    const raw = "not json";
    let caught: AdaptiveImportError | null = null;
    try {
      parseProposalJson(raw);
    } catch (err) {
      caught = err as AdaptiveImportError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.rawResponse).toBe(raw);
    expect(caught?.name).toBe("AdaptiveImportError");
  });
});
