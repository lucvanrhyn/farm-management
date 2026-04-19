/**
 * Tests for lib/tasks/seed-templates.ts
 * TDD — written before implementation (RED phase).
 *
 * Validates:
 * - All 20 templates are present
 * - Required fields are non-empty and valid
 * - RRULE strings parse via expandRule without throwing
 * - Livestock shortcuts are syntactically valid
 * - priorityDefault ∈ { "low", "medium", "high" }
 * - isPublic is true for all
 */
import { describe, it, expect } from "vitest";
import { SEED_TEMPLATES } from "@/lib/tasks/seed-templates";
import { expandRule } from "@/lib/tasks/recurrence";

const VALID_TASK_TYPES = new Set([
  "weighing",
  "treatment",
  "dipping",
  "pregnancy_scan",
  "shearing",
  "crutching",
  "vaccination",
  "brucellosis_test",
  "camp_inspection",
  "camp_move",
  "water_point_service",
  "fence_repair",
  "fire_break_maintenance",
  "rainfall_reading",
  "generic",
]);

const VALID_PRIORITIES = new Set(["low", "medium", "high"]);
const VALID_SPECIES = new Set(["cattle", "sheep", "game", null, undefined]);

describe("SEED_TEMPLATES — structure", () => {
  it("exports exactly 20 templates", () => {
    expect(SEED_TEMPLATES).toHaveLength(20);
  });

  it("every template has a non-empty name", () => {
    for (const t of SEED_TEMPLATES) {
      expect(typeof t.name).toBe("string");
      expect(t.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("every template has a non-empty Afrikaans name (name_af)", () => {
    for (const t of SEED_TEMPLATES) {
      expect(typeof t.name_af).toBe("string");
      expect((t.name_af as string).trim().length).toBeGreaterThan(0);
    }
  });

  it("every template has a valid taskType", () => {
    for (const t of SEED_TEMPLATES) {
      expect(VALID_TASK_TYPES.has(t.taskType)).toBe(true);
    }
  });

  it("every template has priorityDefault ∈ { low, medium, high }", () => {
    for (const t of SEED_TEMPLATES) {
      expect(VALID_PRIORITIES.has(t.priorityDefault as string)).toBe(true);
    }
  });

  it("every template has isPublic = true", () => {
    for (const t of SEED_TEMPLATES) {
      expect(t.isPublic).toBe(true);
    }
  });

  it("species field is null or one of cattle|sheep|game", () => {
    for (const t of SEED_TEMPLATES) {
      expect(VALID_SPECIES.has(t.species as string | null | undefined)).toBe(true);
    }
  });

  it("reminderOffset is a non-negative integer when set", () => {
    for (const t of SEED_TEMPLATES) {
      if (t.reminderOffset != null) {
        expect(Number.isInteger(t.reminderOffset)).toBe(true);
        expect(t.reminderOffset).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("all names are unique", () => {
    const names = SEED_TEMPLATES.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

// ────────────────────────────────────────────────────────────────
// Recurrence rule validation
// ────────────────────────────────────────────────────────────────
describe("SEED_TEMPLATES — recurrence rule validity", () => {
  const fromDate = new Date(Date.UTC(2026, 0, 1)); // Jan 1 2026

  // Templates with RRULE strings
  const rruleTemplates = SEED_TEMPLATES.filter(
    (t) => t.recurrenceRule && !t.recurrenceRule.startsWith("after:") && !t.recurrenceRule.startsWith("before:") && !t.recurrenceRule.startsWith("season:")
  );

  // Templates with livestock shortcuts
  const afterTemplates = SEED_TEMPLATES.filter(
    (t) => t.recurrenceRule?.startsWith("after:")
  );

  const seasonTemplates = SEED_TEMPLATES.filter(
    (t) => t.recurrenceRule?.startsWith("season:")
  );

  it("all RRULE templates expand without throwing (365d horizon)", () => {
    for (const t of rruleTemplates) {
      expect(() => expandRule(t.recurrenceRule!, fromDate, 365)).not.toThrow();
    }
  });

  it("all after: shortcut templates expand without throwing (empty ctx)", () => {
    for (const t of afterTemplates) {
      expect(() => expandRule(t.recurrenceRule!, fromDate, 365, { events: [] })).not.toThrow();
    }
  });

  it("all season: shortcut templates expand without throwing (empty ctx)", () => {
    for (const t of seasonTemplates) {
      expect(() => expandRule(t.recurrenceRule!, fromDate, 365, { seasonWindows: {} })).not.toThrow();
    }
  });

  it("all templates with recurrenceRule have a syntactically valid rule", () => {
    for (const t of SEED_TEMPLATES) {
      if (!t.recurrenceRule) continue;
      // Must not throw with empty ctx (though after:/season: may return [])
      expect(() =>
        expandRule(t.recurrenceRule!, fromDate, 365, { events: [], seasonWindows: {} })
      ).not.toThrow();
    }
  });
});

// ────────────────────────────────────────────────────────────────
// Expected templates by name
// ────────────────────────────────────────────────────────────────
describe("SEED_TEMPLATES — expected specific templates present", () => {
  const byName = (name: string) => SEED_TEMPLATES.find((t) => t.name === name);

  it("includes 'Dip day — cattle'", () => {
    const t = byName("Dip day — cattle");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("dipping");
    expect(t!.recurrenceRule).toContain("season:");
  });

  it("includes 'Brucellosis test — breeding heifers'", () => {
    const t = byName("Brucellosis test — breeding heifers");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("brucellosis_test");
    expect(t!.priorityDefault).toBe("high");
  });

  it("includes 'Tuberculosis test — dairy'", () => {
    const t = byName("Tuberculosis test — dairy");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("treatment");
  });

  it("includes 'Shearing — Dohne Merino'", () => {
    const t = byName("Shearing — Dohne Merino");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("shearing");
    expect(t!.recurrenceRule).toContain("FREQ=MONTHLY;INTERVAL=8");
  });

  it("includes 'Crutching — pre-lambing'", () => {
    const t = byName("Crutching — pre-lambing");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("shearing");
    expect(t!.recurrenceRule).toContain("before:lambing");
  });

  it("includes 'Anthrax vax — KZN/Limpopo'", () => {
    const t = byName("Anthrax vax — KZN/Limpopo");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("vaccination");
    expect(t!.recurrenceRule).toContain("BYMONTH=8");
  });

  it("includes 'RVF vax'", () => {
    const t = byName("RVF vax");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("vaccination");
    expect(t!.recurrenceRule).toContain("BYMONTH=9");
  });

  it("includes 'Lumpy Skin vax'", () => {
    const t = byName("Lumpy Skin vax");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("vaccination");
  });

  it("includes 'Bluetongue vax — sheep' with species=sheep", () => {
    const t = byName("Bluetongue vax — sheep");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("vaccination");
    expect(t!.species).toBe("sheep");
  });

  it("includes 'Pregnancy scan — beef herd'", () => {
    const t = byName("Pregnancy scan — beef herd");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("pregnancy_scan");
    expect(t!.recurrenceRule).toContain("after:mating_start");
  });

  it("includes 'Weaning — beef calves'", () => {
    const t = byName("Weaning — beef calves");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("weighing");
    expect(t!.recurrenceRule).toContain("after:calving");
  });

  it("includes 'Rainfall log'", () => {
    const t = byName("Rainfall log");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("rainfall_reading");
    expect(t!.recurrenceRule).toContain("FREQ=WEEKLY");
    expect(t!.reminderOffset).toBe(0);
  });

  it("includes 'Veld inspection'", () => {
    const t = byName("Veld inspection");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("camp_inspection");
    expect(t!.recurrenceRule).toContain("FREQ=DAILY;INTERVAL=21");
  });

  it("includes 'Water-point service'", () => {
    const t = byName("Water-point service");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("water_point_service");
    expect(t!.recurrenceRule).toContain("FREQ=DAILY;INTERVAL=30");
  });

  it("includes 'Fence inspection — game fence' with species=game", () => {
    const t = byName("Fence inspection — game fence");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("fence_repair");
    expect(t!.species).toBe("game");
    expect(t!.recurrenceRule).toContain("FREQ=DAILY;INTERVAL=14");
  });

  it("includes 'Fire break — pre-fire-season' with high priority", () => {
    const t = byName("Fire break — pre-fire-season");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("fire_break_maintenance");
    expect(t!.priorityDefault).toBe("high");
    expect(t!.recurrenceRule).toContain("BYMONTH=4");
  });

  it("includes 'Fire break — post-fire-season'", () => {
    const t = byName("Fire break — post-fire-season");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("fire_break_maintenance");
    expect(t!.recurrenceRule).toContain("BYMONTH=10");
  });

  it("includes 'SARS IT3-C prep'", () => {
    const t = byName("SARS IT3-C prep");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("generic");
    expect(t!.recurrenceRule).toContain("BYMONTH=2");
  });

  it("includes 'VAT201 submission'", () => {
    const t = byName("VAT201 submission");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("generic");
    expect(t!.recurrenceRule).toContain("BYMONTHDAY=25");
  });

  it("includes 'RMIS herd declaration refresh' with high priority", () => {
    const t = byName("RMIS herd declaration refresh");
    expect(t).toBeDefined();
    expect(t!.taskType).toBe("generic");
    expect(t!.priorityDefault).toBe("high");
    expect(t!.recurrenceRule).toContain("BYMONTH=4");
  });
});
