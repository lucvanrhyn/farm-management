/**
 * Tests for lib/tasks/observation-mapping.ts
 * TDD — written before implementation (RED phase).
 *
 * Covers every taskType mapping + the "incomplete payload → null" branch
 * for each required-key case.
 */
import { describe, it, expect } from "vitest";
import { observationFromTaskCompletion } from "@/lib/tasks/observation-mapping";
import type { TaskCompletionPayload } from "@/lib/tasks/observation-mapping";

// Minimal valid task fixture
const baseTask = {
  id: "task-1",
  taskType: null as string | null,
  animalId: "animal-1",
  campId: "camp-A",
  lat: -25.7461,
  lng: 28.1881,
  assignedTo: "worker@farm.com",
};

// ────────────────────────────────────────────────────────────────
// weighing
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — weighing", () => {
  it("maps weighing task with weightKg to weighing observation", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "weighing" },
      { weightKg: 320 },
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("weighing");
    expect(result!.loggedBy).toBe("worker@farm.com");
    expect(result!.animalId).toBe("animal-1");
    expect(result!.campId).toBe("camp-A");
    expect(result!.lat).toBe(-25.7461);
    expect(result!.lng).toBe(28.1881);
    const details = JSON.parse(result!.details);
    expect(details.weightKg).toBe(320);
  });

  it("returns null when weightKg is missing from payload", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "weighing" },
      {},
    );
    expect(result).toBeNull();
  });

  it("returns null when weightKg is not a number", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "weighing" },
      { weightKg: "heavy" },
    );
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// treatment
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — treatment", () => {
  it("maps treatment task with product to treatment observation", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "treatment" },
      { product: "Terramycin", dose: "10ml", subtype: "antibiotic" },
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("treatment");
    const details = JSON.parse(result!.details);
    expect(details.product).toBe("Terramycin");
    expect(details.dose).toBe("10ml");
    expect(details.subtype).toBe("antibiotic");
  });

  it("returns null when product is missing", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "treatment" },
      { dose: "10ml" },
    );
    expect(result).toBeNull();
  });

  it("returns null when product is not a string", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "treatment" },
      { product: 42 },
    );
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// dipping
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — dipping", () => {
  it("maps dipping to treatment observation with subtype=dip", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "dipping" },
      { product: "Triatix" },
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("treatment");
    const details = JSON.parse(result!.details);
    expect(details.subtype).toBe("dip");
    expect(details.product).toBe("Triatix");
  });

  it("returns null when dipping product is missing", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "dipping" },
      {},
    );
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// pregnancy_scan
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — pregnancy_scan", () => {
  it("maps pregnancy_scan with pregnant result", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "pregnancy_scan" },
      { result: "pregnant" },
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("pregnancy_scan");
    const details = JSON.parse(result!.details);
    expect(details.result).toBe("pregnant");
  });

  it("maps pregnancy_scan with open result", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "pregnancy_scan" },
      { result: "open" },
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("pregnancy_scan");
  });

  it("maps pregnancy_scan with recheck result", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "pregnancy_scan" },
      { result: "recheck" },
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("pregnancy_scan");
  });

  it("returns null when result is missing from pregnancy_scan", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "pregnancy_scan" },
      {},
    );
    expect(result).toBeNull();
  });

  it("returns null when result is not a string", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "pregnancy_scan" },
      { result: true },
    );
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// shearing
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — shearing", () => {
  it("maps shearing to treatment with subtype=shearing", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "shearing" },
      { product: "Manual shearing" },
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("treatment");
    const details = JSON.parse(result!.details);
    expect(details.subtype).toBe("shearing");
  });

  it("shearing with no product still succeeds (product optional for shearing)", () => {
    // Shearing does not require product — it defaults to empty/null
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "shearing" },
      {},
    );
    // Should return non-null — shearing itself is the activity
    expect(result).not.toBeNull();
    expect(result!.type).toBe("treatment");
    const details = JSON.parse(result!.details);
    expect(details.subtype).toBe("shearing");
  });
});

// ────────────────────────────────────────────────────────────────
// crutching
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — crutching", () => {
  it("maps crutching to treatment with subtype=crutching", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "crutching" },
      {},
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("treatment");
    const details = JSON.parse(result!.details);
    expect(details.subtype).toBe("crutching");
  });
});

// ────────────────────────────────────────────────────────────────
// vaccination
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — vaccination", () => {
  it("maps vaccination to treatment with subtype=vaccine", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "vaccination" },
      { product: "RVF vaccine" },
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("treatment");
    const details = JSON.parse(result!.details);
    expect(details.subtype).toBe("vaccine");
    expect(details.product).toBe("RVF vaccine");
  });

  it("returns null when vaccination product is missing", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "vaccination" },
      {},
    );
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// brucellosis_test
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — brucellosis_test", () => {
  it("maps brucellosis_test to health_issue observation", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "brucellosis_test" },
      { result: "negative" },
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("health_issue");
    const details = JSON.parse(result!.details);
    expect(details.result).toBe("negative");
  });

  it("returns null when brucellosis_test result is missing", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "brucellosis_test" },
      {},
    );
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// Reminder-only task types — all return null (issue #360)
//
// rainfall_reading, camp_inspection, and camp_move are reminder-only:
// completing the task marks the reminder done but produces no
// Observation. Each has a dedicated capture surface elsewhere —
//   - rainfall_reading → the RainfallRecord model + the
//     /api/[farmSlug]/rainfall admin page (a `rainfall` Observation
//     would be a split-brain second home for the same data)
//   - camp_inspection → the logger's CampConditionForm, which records
//     real grazing/water/fence values (a {condition} stub here would
//     be the silent "all-good" default write #321 closed)
//   - camp_move → the move-mob flow, which records animal_movement /
//     mob_movement observations through the door
//
// They join water_point_service / fence_repair / fire_break_maintenance
// / generic. observation-mapping.ts therefore never emits a payload the
// ADR-0006 createObservation door would reject.
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — reminder-only task types return null", () => {
  const reminderOnlyTypes = [
    "rainfall_reading",
    "camp_inspection",
    "camp_move",
    "water_point_service",
    "fence_repair",
    "fire_break_maintenance",
    "generic",
  ] as const;

  for (const taskType of reminderOnlyTypes) {
    it(`returns null for taskType=${taskType} with a populated payload`, () => {
      // Includes rainfallMm / condition / toCampId — the exact keys that
      // used to drive the off-spec rainfall / camp_condition / camp_move
      // emissions — to prove the reminder-only contract holds.
      const result = observationFromTaskCompletion(
        { ...baseTask, taskType },
        {
          product: "anything",
          condition: "good",
          weightKg: 100,
          rainfallMm: 12.5,
          toCampId: "camp-B",
        },
      );
      expect(result).toBeNull();
    });

    it(`returns null for taskType=${taskType} with an empty payload`, () => {
      const result = observationFromTaskCompletion(
        { ...baseTask, taskType },
        {},
      );
      expect(result).toBeNull();
    });
  }
});

// ────────────────────────────────────────────────────────────────
// null / unknown taskType
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — null and unknown taskType", () => {
  it("returns null when taskType is null", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: null },
      { weightKg: 100 },
    );
    expect(result).toBeNull();
  });

  it("returns null for unknown taskType string", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "something_unknown" },
      { product: "X" },
    );
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// Passthrough of task fields (lat/lng/animalId/campId)
// ────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — field passthrough", () => {
  it("passes null animalId when task has no animalId", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "weighing", animalId: null },
      { weightKg: 275 },
    );
    expect(result).not.toBeNull();
    expect(result!.animalId).toBeNull();
  });

  it("passes null lat/lng when task has no coordinates", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "weighing", lat: null, lng: null },
      { weightKg: 200 },
    );
    expect(result).not.toBeNull();
    expect(result!.lat).toBeNull();
    expect(result!.lng).toBeNull();
  });

  it("uses assignedTo as loggedBy", () => {
    const result = observationFromTaskCompletion(
      { ...baseTask, taskType: "weighing", assignedTo: "john@farm.com" },
      { weightKg: 250 },
    );
    expect(result).not.toBeNull();
    expect(result!.loggedBy).toBe("john@farm.com");
  });
});
