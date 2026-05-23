/**
 * @vitest-environment node
 *
 * Issue #394 — registry parser correctness for the nine previously
 * uncovered persistence-canonical types.
 *
 * The structural arch test (`tests/arch/observation-registry-coverage`)
 * locks the SHAPE: every type has a label + parser + form. This suite
 * locks the CONTENT for the long tail that used to fall through to the
 * `"Details recorded"` placeholder.
 */
import { describe, it, expect } from "vitest";

import {
  parseObservationDetails,
  getObservationTypeLabel,
} from "@/components/admin/observations-log/registry";

describe("registry.parseObservationDetails — formerly-uncovered types", () => {
  it("scrotal_circumference renders the cm measurement", () => {
    const out = parseObservationDetails(
      "scrotal_circumference",
      JSON.stringify({ measurement_cm: 42 }),
    );
    expect(out).not.toMatch(/details recorded/i);
    expect(out).toMatch(/42/);
    expect(out).toMatch(/cm/i);
  });

  it("body_condition_score renders the score with /9 scale", () => {
    const out = parseObservationDetails(
      "body_condition_score",
      JSON.stringify({ score: 5 }),
    );
    expect(out).not.toMatch(/details recorded/i);
    expect(out).toMatch(/5/);
    expect(out).toMatch(/bcs|body condition|condition/i);
  });

  it("temperament_score renders the score", () => {
    const out = parseObservationDetails(
      "temperament_score",
      JSON.stringify({ score: 3 }),
    );
    expect(out).not.toMatch(/details recorded/i);
    expect(out).toMatch(/3/);
    expect(out).toMatch(/temperament/i);
  });

  it("heat_detection renders the method", () => {
    const out = parseObservationDetails(
      "heat_detection",
      JSON.stringify({ method: "visual" }),
    );
    expect(out).toMatch(/visual/i);
  });

  it("general note renders the note text if present", () => {
    const out = parseObservationDetails(
      "general",
      JSON.stringify({ note: "Fence repaired" }),
    );
    expect(out).not.toMatch(/details recorded/i);
    expect(out).toMatch(/fence repaired/i);
  });

  it("drying_off does not fall back to 'Details recorded'", () => {
    const out = parseObservationDetails("drying_off", JSON.stringify({}));
    expect(out).not.toMatch(/details recorded/i);
    expect(out.length).toBeGreaterThan(0);
  });

  it("weaning does not fall back to 'Details recorded'", () => {
    const out = parseObservationDetails(
      "weaning",
      JSON.stringify({ weight_kg: 180 }),
    );
    expect(out).not.toMatch(/details recorded/i);
    expect(out).toMatch(/180/);
  });

  it("game_census renders species and count", () => {
    const out = parseObservationDetails(
      "game_census",
      JSON.stringify({ species: "Impala", count: 12 }),
    );
    expect(out).not.toMatch(/details recorded/i);
    expect(out).toMatch(/impala/i);
    expect(out).toMatch(/12/);
  });

  it("game_sighting renders species and count", () => {
    const out = parseObservationDetails(
      "game_sighting",
      JSON.stringify({ species: "Eland", count: 3 }),
    );
    expect(out).not.toMatch(/details recorded/i);
    expect(out).toMatch(/eland/i);
    expect(out).toMatch(/3/);
  });
});

describe("registry.getObservationTypeLabel — every type", () => {
  it("scrotal_circumference label is human-readable", () => {
    expect(getObservationTypeLabel("scrotal_circumference")).toBe(
      "Scrotal Circumference",
    );
  });
  it("body_condition_score label is human-readable", () => {
    expect(getObservationTypeLabel("body_condition_score")).toBe(
      "Body Condition Score",
    );
  });
  it("temperament_score label is human-readable", () => {
    expect(getObservationTypeLabel("temperament_score")).toBe(
      "Temperament Score",
    );
  });
  it("heat_detection label is human-readable", () => {
    expect(getObservationTypeLabel("heat_detection")).toBe("Heat Detection");
  });
  it("drying_off label is human-readable", () => {
    expect(getObservationTypeLabel("drying_off")).toBe("Drying Off");
  });
  it("weaning label is human-readable", () => {
    expect(getObservationTypeLabel("weaning")).toBe("Weaning");
  });
  it("general label is human-readable", () => {
    expect(getObservationTypeLabel("general")).toBe("General Note");
  });
  it("game_census label is human-readable", () => {
    expect(getObservationTypeLabel("game_census")).toBe("Game Census");
  });
  it("game_sighting label is human-readable", () => {
    expect(getObservationTypeLabel("game_sighting")).toBe("Game Sighting");
  });
});
