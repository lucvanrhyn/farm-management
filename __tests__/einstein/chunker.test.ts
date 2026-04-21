/**
 * @vitest-environment node
 *
 * __tests__/einstein/chunker.test.ts
 *
 * Unit tests for lib/einstein/chunker.ts — deterministic toEmbeddingText().
 * All tests must pass without network calls or external dependencies.
 */

import { describe, it, expect } from "vitest";
import { toEmbeddingText } from "@/lib/einstein/chunker";
import type { ChunkInput } from "@/lib/einstein/chunker";
import {
  ALL_FIXTURES,
  task_template_dual,
  task_template_en_only,
  task_template_dual_anthrax,
  edge_template_empty_af,
  obs_weighing_full,
  obs_treatment_no_operator,
} from "./chunker-fixtures";

// ---------------------------------------------------------------------------
// 1. Golden fixture suite — parameterised
// ---------------------------------------------------------------------------

describe("toEmbeddingText — golden fixtures", () => {
  it.each(ALL_FIXTURES.map((f, i) => [i, f] as const))(
    "fixture[%i] matches expected output",
    (_i, { input, expected }) => {
      const result = toEmbeddingText(input);
      expect(result).toEqual(expected);
    }
  );
});

// ---------------------------------------------------------------------------
// 2. Determinism — same input → identical output on repeated calls
// ---------------------------------------------------------------------------

describe("toEmbeddingText — determinism", () => {
  it("returns identical output on repeated calls with the same observation input", () => {
    const { input } = obs_weighing_full;
    const first = toEmbeddingText(input);
    const second = toEmbeddingText(input);
    expect(first).toEqual(second);
  });

  it("returns identical output on repeated calls with the same task_template dual input", () => {
    const { input } = task_template_dual;
    const first = toEmbeddingText(input);
    const second = toEmbeddingText(input);
    expect(first).toEqual(second);
  });

  it("repeated calls produce the same text strings, not just structurally equal", () => {
    const { input } = obs_treatment_no_operator;
    const a = toEmbeddingText(input);
    const b = toEmbeddingText(input);
    expect(a[0].text).toBe(b[0].text);
  });
});

// ---------------------------------------------------------------------------
// 3. Afrikaans-dual rule — task_template
// ---------------------------------------------------------------------------

describe("toEmbeddingText — Afrikaans-dual rule", () => {
  it("task_template with name_af returns exactly 2 chunks", () => {
    const result = toEmbeddingText(task_template_dual.input);
    expect(result).toHaveLength(2);
  });

  it("task_template without name_af returns exactly 1 chunk", () => {
    const result = toEmbeddingText(task_template_en_only.input);
    expect(result).toHaveLength(1);
  });

  it("task_template with empty string name_af returns exactly 1 chunk", () => {
    const input: ChunkInput = {
      entityType: "task_template",
      entityId: "tmpl-empty-af",
      row: {
        name: "Weekly check",
        taskType: "camp_inspection",
        recurrenceRule: "FREQ=WEEKLY",
        species: "cattle",
        name_af: "",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    };
    const result = toEmbeddingText(input);
    expect(result).toHaveLength(1);
  });

  it("task_template with null name_af returns exactly 1 chunk", () => {
    const result = toEmbeddingText(task_template_en_only.input);
    expect(result).toHaveLength(1);
    expect(result[0].langTag).toBe("en");
  });

  it("dual chunks have distinct langTag values", () => {
    const result = toEmbeddingText(task_template_dual.input);
    const tags = result.map((c) => c.langTag);
    expect(tags).toContain("en");
    expect(tags).toContain("af");
  });

  it("dual chunks share the same entityId", () => {
    const result = toEmbeddingText(task_template_dual.input);
    expect(result[0].entityId).toBe(result[1].entityId);
    expect(result[0].entityId).toBe("tmpl-002");
  });

  it("dual chunks share the same entityType", () => {
    const result = toEmbeddingText(task_template_dual.input);
    expect(result[0].entityType).toBe("task_template");
    expect(result[1].entityType).toBe("task_template");
  });

  it("dual chunks share the same sourceUpdatedAt", () => {
    const result = toEmbeddingText(task_template_dual.input);
    expect(result[0].sourceUpdatedAt).toEqual(result[1].sourceUpdatedAt);
  });

  it("English chunk comes before Afrikaans chunk", () => {
    const result = toEmbeddingText(task_template_dual.input);
    expect(result[0].langTag).toBe("en");
    expect(result[1].langTag).toBe("af");
  });

  it("Afrikaans chunk uses 'spesie' in place of 'species'", () => {
    // Post-chunker-fix (2026-04-21): recurrence is a raw RRULE string now,
    // not a translated "elke N dae" phrase. Only the species keyword is
    // localised; the RRULE stays machine-readable in both langs.
    const result = toEmbeddingText(task_template_dual.input);
    const afChunk = result.find((c) => c.langTag === "af")!;
    expect(afChunk.text).toContain("spesie");
    // The English variant must NOT use the Afrikaans keyword
    const enChunk = result.find((c) => c.langTag === "en")!;
    expect(enChunk.text).toContain("species");
    expect(enChunk.text).not.toContain("spesie ");
  });

  it("another dual template also yields 2 chunks", () => {
    const result = toEmbeddingText(task_template_dual_anthrax.input);
    expect(result).toHaveLength(2);
  });

  it("edge template with empty af string treated as no Afrikaans", () => {
    const result = toEmbeddingText(edge_template_empty_af.input);
    expect(result).toHaveLength(1);
    expect(result[0].langTag).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// 4. Date formatting — ISO date, no timezone leakage
// ---------------------------------------------------------------------------

describe("toEmbeddingText — date formatting", () => {
  it("observation date uses YYYY-MM-DD format from row.date string", () => {
    const result = toEmbeddingText(obs_weighing_full.input);
    expect(result[0].text).toContain("@ 2026-01-15");
  });

  it("observation with Date object in observedAt field formats correctly", () => {
    const input: ChunkInput = {
      entityType: "observation",
      entityId: "obs-date-obj",
      row: {
        type: "WEIGHING",
        observedAt: new Date("2026-06-15T12:00:00.000Z"),
        animalId: "animal-daisy",
        animalName: "Daisy",
        species: "Cattle",
        breed: "Jersey",
        campId: "camp-1",
        details: "350kg",
        updatedAt: new Date("2026-06-15T12:00:00.000Z"),
      },
    };
    const result = toEmbeddingText(input);
    // Should produce YYYY-MM-DD, not a locale string
    expect(result[0].text).toMatch(/@ \d{4}-\d{2}-\d{2}/);
  });

  it("notification date uses YYYY-MM-DD format from row.createdAt string", () => {
    const input: ChunkInput = {
      entityType: "notification",
      entityId: "notif-date-test",
      row: {
        type: "ALERT",
        createdAt: "2026-05-01",
        message: "Test message",
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    };
    const result = toEmbeddingText(input);
    expect(result[0].text).toContain("@ 2026-05-01");
  });
});

// ---------------------------------------------------------------------------
// 5. sourceUpdatedAt fallback chain (updatedAt → editedAt → createdAt)
// ---------------------------------------------------------------------------

describe("toEmbeddingText — sourceUpdatedAt fallback", () => {
  it("uses updatedAt when present", () => {
    const updatedAt = new Date("2026-03-01T00:00:00.000Z");
    const input: ChunkInput = {
      entityType: "camp",
      entityId: "camp-fallback-1",
      row: {
        campName: "Test Camp",
        sizeHectares: 10,
        veldType: "mixedveld",
        waterSource: "dam",
        rotationNotes: null,
        updatedAt,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    };
    const result = toEmbeddingText(input);
    expect(result[0].sourceUpdatedAt).toEqual(updatedAt);
  });

  it("falls back to editedAt when updatedAt is absent", () => {
    const editedAt = new Date("2026-03-15T00:00:00.000Z");
    const input: ChunkInput = {
      entityType: "camp",
      entityId: "camp-fallback-2",
      row: {
        campName: "Edit Camp",
        sizeHectares: 8,
        veldType: "sweetveld",
        waterSource: "borehole",
        rotationNotes: null,
        editedAt,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    };
    const result = toEmbeddingText(input);
    expect(result[0].sourceUpdatedAt).toEqual(editedAt);
  });

  it("falls back to createdAt when both updatedAt and editedAt are absent", () => {
    const createdAt = new Date("2026-02-20T00:00:00.000Z");
    const input: ChunkInput = {
      entityType: "animal",
      entityId: "animal-fallback-3",
      row: {
        animalId: "animal-fallback-3",
        name: "FallbackCow",
        registrationNumber: "REG-FB-001",
        species: "Cattle",
        breed: "Nguni",
        dateOfBirth: "2024-04-01",
        motherId: null,
        currentCamp: "camp-1",
        status: "active",
        createdAt,
      },
    };
    const result = toEmbeddingText(input);
    expect(result[0].sourceUpdatedAt).toEqual(createdAt);
  });
});

// ---------------------------------------------------------------------------
// 6. Entity type coverage — all 7 types produce at least one chunk
// ---------------------------------------------------------------------------

describe("toEmbeddingText — all entity types produce output", () => {
  const ENTITY_TYPES = [
    "observation",
    "camp",
    "animal",
    "task",
    "task_template",
    "notification",
    "it3_snapshot",
  ] as const;

  ENTITY_TYPES.forEach((entityType) => {
    it(`${entityType} yields at least one chunk`, () => {
      const fixture = ALL_FIXTURES.find((f) => f.input.entityType === entityType);
      expect(fixture).toBeDefined();
      const result = toEmbeddingText(fixture!.input);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Output shape invariants
// ---------------------------------------------------------------------------

describe("toEmbeddingText — output shape invariants", () => {
  it("every chunk has a non-empty text string", () => {
    for (const { input } of ALL_FIXTURES) {
      const result = toEmbeddingText(input);
      for (const chunk of result) {
        expect(chunk.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("every chunk has a sourceUpdatedAt that is a Date instance", () => {
    for (const { input } of ALL_FIXTURES) {
      const result = toEmbeddingText(input);
      for (const chunk of result) {
        expect(chunk.sourceUpdatedAt).toBeInstanceOf(Date);
      }
    }
  });

  it("every chunk entityId matches the input entityId", () => {
    for (const { input } of ALL_FIXTURES) {
      const result = toEmbeddingText(input);
      for (const chunk of result) {
        expect(chunk.entityId).toBe(input.entityId);
      }
    }
  });

  it("every chunk entityType matches the input entityType", () => {
    for (const { input } of ALL_FIXTURES) {
      const result = toEmbeddingText(input);
      for (const chunk of result) {
        expect(chunk.entityType).toBe(input.entityType);
      }
    }
  });

  it("very long text fixture still produces exactly 1 chunk (no splitting)", () => {
    const LONG_DETAILS = "A".repeat(1800);
    const input: ChunkInput = {
      entityType: "observation",
      entityId: "obs-long",
      row: {
        type: "TREATMENT",
        observedAt: "2026-01-10",
        animalId: "animal-big",
        animalName: "BigText",
        species: "Cattle",
        breed: "Angus",
        campId: "camp-x",
        details: LONG_DETAILS,
        updatedAt: new Date("2026-01-10T00:00:00.000Z"),
      },
    };
    const result = toEmbeddingText(input);
    expect(result).toHaveLength(1);
  });
});
