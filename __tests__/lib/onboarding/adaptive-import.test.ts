import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_VERSION,
} from "@/lib/onboarding/schema-dictionary";

// The SDK is hoisted-mocked below. We import the module-under-test AFTER
// the mock so the mocked OpenAI constructor is in place.

const chatCompletionsCreateMock = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create: chatCompletionsCreateMock } };
    constructor(_opts?: { apiKey?: string }) {}
  }
  return { default: MockOpenAI };
});

import {
  proposeColumnMapping,
  buildUserPrompt,
  parseProposalJson,
  validateMappingProposal,
  computeUsage,
  checkSexTransformAgainstSamples,
  sanityCheckMapping,
  AdaptiveImportError,
  GPT_4O_MINI_RATES,
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
      Status: "active",
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
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens: number;
  }> = {}
) {
  const promptTokens = usage.prompt_tokens ?? 5800;
  const completionTokens = usage.completion_tokens ?? 1500;
  const cachedTokens = usage.cached_tokens ?? 5000;
  chatCompletionsCreateMock.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(json) } }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      prompt_tokens_details: { cached_tokens: cachedTokens },
    },
  });
}

// ---------------------------------------------------------------------------
// Env var isolation
// ---------------------------------------------------------------------------

const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  envBackup.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-DO-NOT-USE";
  chatCompletionsCreateMock.mockReset();
});

afterEach(() => {
  if (envBackup.OPENAI_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = envBackup.OPENAI_API_KEY;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proposeColumnMapping — environment", () => {
  it("throws AdaptiveImportError when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(proposeColumnMapping(bassonInput)).rejects.toBeInstanceOf(
      AdaptiveImportError
    );
  });
});

describe("proposeColumnMapping — happy path", () => {
  it("returns a validated ProposalResult for a well-formed response", async () => {
    mockSdkResponse(happyPathProposal);
    const result = await proposeColumnMapping(bassonInput);

    expect(result.model).toBe("gpt-4o-mini");
    expect(result.promptVersion).toBe(SYSTEM_PROMPT_VERSION);
    expect(result.proposal.row_count).toBe(103);
    expect(result.proposal.mapping).toHaveLength(8);
    expect(result.proposal.unmapped).toHaveLength(1);
    // With prompt_tokens=5800, cached_tokens=5000 → non-cached input = 800
    expect(result.usage.inputTokens).toBe(800);
    expect(result.usage.cacheReadTokens).toBe(5000);
    expect(result.usage.cacheCreationTokens).toBe(0);
    expect(result.usage.costZar).toBeGreaterThan(0);
  });

  it("calls the SDK with JSON mode and gpt-4o-mini", async () => {
    mockSdkResponse(happyPathProposal);
    await proposeColumnMapping(bassonInput);

    expect(chatCompletionsCreateMock).toHaveBeenCalledTimes(1);
    const call = chatCompletionsCreateMock.mock.calls[0][0];
    expect(call.model).toBe("gpt-4o-mini");
    expect(call.response_format).toEqual({ type: "json_object" });
  });

  it("sends SYSTEM_PROMPT as a plain system message", async () => {
    mockSdkResponse(happyPathProposal);
    await proposeColumnMapping(bassonInput);

    const call = chatCompletionsCreateMock.mock.calls[0][0];
    expect(Array.isArray(call.messages)).toBe(true);
    expect(call.messages[0].role).toBe("system");
    // SYSTEM_PROMPT is forwarded verbatim (OpenAI caches >=1024 tok prompts
    // automatically — no cache_control markers needed).
    expect(call.messages[0].content).toBe(SYSTEM_PROMPT);
  });

  it("keeps per-request data in the user prompt, not the system block", async () => {
    mockSdkResponse(happyPathProposal);
    await proposeColumnMapping(bassonInput);

    // The previous test already pins the system message text. Here we just
    // assert the user block carries the farm-specific payload.
    const call = chatCompletionsCreateMock.mock.calls[0][0];
    const userMsg = call.messages[1];
    expect(userMsg.role).toBe("user");
    const userText = userMsg.content;
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
  it("computes uncached path cost (no cache hits)", () => {
    // prompt_tokens=5800, cached=0 → all 5800 billed as non-cached input
    // input: 5800/1M * 0.15 = 0.00087
    // output: 1500/1M * 0.60 = 0.0009
    // total = 0.00177 USD
    const usage = computeUsage(
      {
        prompt_tokens: 5800,
        completion_tokens: 1500,
        cached_tokens: 0,
      },
      GPT_4O_MINI_RATES,
      ZAR_PER_USD
    );
    expect(usage.costUsd).toBeCloseTo(0.00177, 5);
    expect(usage.costZar).toBeCloseTo(0.00177 * ZAR_PER_USD, 5);
    expect(usage.inputTokens).toBe(5800);
    expect(usage.outputTokens).toBe(1500);
    expect(usage.cacheCreationTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(0);
  });

  it("computes cache-hit path cost — ~20x cheaper than Anthropic Sonnet", () => {
    // prompt_tokens=5800, cached=5000 → non-cached input = 800
    // input: 800/1M * 0.15 = 0.00012
    // cached: 5000/1M * 0.075 = 0.000375
    // output: 1500/1M * 0.60 = 0.0009
    // total = 0.001395 USD ≈ R0.0258
    const usage = computeUsage(
      {
        prompt_tokens: 5800,
        completion_tokens: 1500,
        cached_tokens: 5000,
      },
      GPT_4O_MINI_RATES,
      ZAR_PER_USD
    );
    expect(usage.costUsd).toBeCloseTo(0.001395, 5);
    expect(usage.costZar).toBeLessThan(0.1);
    expect(usage.costZar).toBeGreaterThan(0.01);
    expect(usage.inputTokens).toBe(800);
    expect(usage.cacheReadTokens).toBe(5000);
    expect(usage.cacheCreationTokens).toBe(0);
  });

  it("handles null cached_tokens defensively", () => {
    // prompt_tokens=100, completion=100, cached=null → non-cached = 100
    // input: 100/1M * 0.15 = 0.000015
    // output: 100/1M * 0.60 = 0.00006
    // total = 0.000075 USD
    const usage = computeUsage(
      {
        prompt_tokens: 100,
        completion_tokens: 100,
        cached_tokens: null,
      },
      GPT_4O_MINI_RATES,
      ZAR_PER_USD
    );
    expect(usage.cacheCreationTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(0);
    expect(usage.inputTokens).toBe(100);
    expect(usage.costUsd).toBeCloseTo(0.000075, 6);
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

// ---------------------------------------------------------------------------
// Commit A hardening
// ---------------------------------------------------------------------------

describe("validateMappingProposal — duplicate-source guard (A1)", () => {
  it("rejects proposals where the same source appears in both mapping and unmapped", () => {
    const raw = {
      mapping: [{ source: "Kleur", target: "breed", confidence: 0.8 }],
      unmapped: [
        { source: "Kleur", samples: ["Rooi"], upsell_hint: "coat colour" },
      ],
      warnings: [],
      row_count: 1,
    };
    try {
      validateMappingProposal(raw);
      expect.unreachable("validateMappingProposal should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AdaptiveImportError);
      expect((err as AdaptiveImportError).message).toContain(
        "cannot appear in both mapping and unmapped"
      );
      expect((err as AdaptiveImportError).message).toContain("Kleur");
    }
  });
});

describe("checkSexTransformAgainstSamples (A2)", () => {
  it("demotes confidence and adds a warning when transform doesn't reference observed values", () => {
    const proposal: MappingProposal = {
      mapping: [
        {
          source: "Geslag",
          target: "sex",
          confidence: 0.9,
          transform: "Manlik→Male; Vroulik→Female",
        },
      ],
      unmapped: [],
      warnings: [],
      row_count: 2,
    };
    const out = checkSexTransformAgainstSamples(proposal, [
      { Geslag: "Ooi" },
      { Geslag: "Ram" },
    ]);
    expect(out.mapping[0].confidence).toBe(0.5);
    expect(
      out.warnings.some((w) =>
        w.includes("Sex transform may not match observed values")
      )
    ).toBe(true);
  });

  it("leaves confidence untouched when transform does reference observed values", () => {
    const proposal: MappingProposal = {
      mapping: [
        {
          source: "Geslag",
          target: "sex",
          confidence: 0.9,
          transform: "Manlik→Male; Vroulik→Female",
        },
      ],
      unmapped: [],
      warnings: [],
      row_count: 2,
    };
    const out = checkSexTransformAgainstSamples(proposal, [
      { Geslag: "Manlik" },
      { Geslag: "Vroulik" },
    ]);
    expect(out.mapping[0].confidence).toBe(0.9);
    expect(out.warnings).toHaveLength(0);
  });

  it("leaves confidence untouched when no transform is present", () => {
    const proposal: MappingProposal = {
      mapping: [{ source: "Geslag", target: "sex", confidence: 0.9 }],
      unmapped: [],
      warnings: [],
      row_count: 2,
    };
    const out = checkSexTransformAgainstSamples(proposal, [
      { Geslag: "Ooi" },
    ]);
    expect(out.mapping[0].confidence).toBe(0.9);
    expect(out.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Commit B — sanityCheckMapping
// ---------------------------------------------------------------------------

describe("sanityCheckMapping (B)", () => {
  function baseProposal(mapping: MappingProposal["mapping"]): MappingProposal {
    return { mapping, unmapped: [], warnings: [], row_count: 3 };
  }

  it("demotes Massa→currentCamp when values look like weights", () => {
    const proposal = baseProposal([
      { source: "Massa", target: "currentCamp", confidence: 0.7 },
    ]);
    const rows = [{ Massa: 485 }, { Massa: 510 }, { Massa: 478 }];
    const out = sanityCheckMapping(proposal, rows);
    expect(out.mapping.find((m) => m.source === "Massa")).toBeUndefined();
    const demoted = out.unmapped.find((u) => u.source === "Massa");
    expect(demoted).toBeDefined();
    expect(demoted?.upsell_hint).toContain(
      "don't match target field 'currentCamp'"
    );
    expect(
      out.warnings.some((w) => w.includes("Demoted Massa→currentCamp"))
    ).toBe(true);
  });

  it("demotes Prys→status when values look like prices", () => {
    const proposal = baseProposal([
      { source: "Prys", target: "status", confidence: 0.6 },
    ]);
    const rows = [{ Prys: 8500 }, { Prys: 9200 }];
    const out = sanityCheckMapping(proposal, rows);
    expect(out.mapping.find((m) => m.source === "Prys")).toBeUndefined();
    expect(out.unmapped.find((u) => u.source === "Prys")).toBeDefined();
    expect(
      out.warnings.some((w) => w.includes("Demoted Prys→status"))
    ).toBe(true);
  });

  it("keeps valid earTag mappings in place", () => {
    const proposal = baseProposal([
      { source: "Oormerk", target: "earTag", confidence: 0.98 },
    ]);
    const rows = [{ Oormerk: "BB-C001" }, { Oormerk: "BB-C002" }];
    const out = sanityCheckMapping(proposal, rows);
    expect(out.mapping.find((m) => m.source === "Oormerk")).toBeDefined();
    expect(out.unmapped.find((u) => u.source === "Oormerk")).toBeUndefined();
  });

  it("keeps valid birthDate mappings with mixed date formats", () => {
    const proposal = baseProposal([
      { source: "Geboorte", target: "birthDate", confidence: 0.85 },
    ]);
    const rows = [
      { Geboorte: "2022-01-15" },
      { Geboorte: "15/03/2021" },
      { Geboorte: "2020-06-30" },
    ];
    const out = sanityCheckMapping(proposal, rows);
    expect(out.mapping.find((m) => m.source === "Geboorte")).toBeDefined();
    expect(out.unmapped.find((u) => u.source === "Geboorte")).toBeUndefined();
  });

  it("passes through mappings with no sample values for that column", () => {
    const proposal = baseProposal([
      { source: "MissingCol", target: "earTag", confidence: 0.8 },
    ]);
    const rows = [{ OtherCol: "x" }];
    const out = sanityCheckMapping(proposal, rows);
    expect(out.mapping.find((m) => m.source === "MissingCol")).toBeDefined();
    expect(out.unmapped).toHaveLength(0);
    expect(out.warnings).toHaveLength(0);
  });

  it("passes through unknown target fields without second-guessing the model", () => {
    const proposal = baseProposal([
      {
        source: "Kleur",
        target: "someCustomField",
        confidence: 0.8,
      },
    ]);
    const rows = [{ Kleur: "Rooi" }, { Kleur: "Swart" }, { Kleur: "Wit" }];
    const out = sanityCheckMapping(proposal, rows);
    expect(out.mapping.find((m) => m.source === "Kleur")).toBeDefined();
    expect(out.unmapped).toHaveLength(0);
  });
});
