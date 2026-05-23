// @vitest-environment jsdom
/**
 * Issue #394 — ObservationRow renders a human label and a real detail
 * summary for previously-uncovered observation types.
 *
 * Before W5, `ObservationRow` looked up `TYPE_LABEL[obs.type]` and called
 * `parseDetails(obs.details, obs.type)`. Three persistence-canonical
 * types (`scrotal_circumference`, `body_condition_score`,
 * `temperament_score`) had no `TYPE_LABEL` entry and no `parseDetails`
 * switch case, so the timeline rendered the raw enum identifier
 * (`scrotal_circumference`) plus the generic fallback
 * `"Details recorded"`.
 *
 * W5 wires `ObservationRow` to the unified `OBSERVATION_REGISTRY`. This
 * suite locks the behaviour for three previously-uncovered types.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import type { PrismaObservation } from "@/lib/types";

import { ObservationRow } from "@/components/admin/observations-log/ObservationRow";

function obs(partial: Partial<PrismaObservation>): PrismaObservation {
  return {
    id: "o1",
    type: "weighing",
    campId: "C-01",
    animalId: "A-01",
    details: "{}",
    observedAt: "2026-05-23T10:00:00.000Z",
    createdAt: "2026-05-23T10:00:00.000Z",
    loggedBy: "Dicky",
    editedBy: null,
    editedAt: null,
    editHistory: null,
    attachmentUrl: null,
    ...partial,
  } as PrismaObservation;
}

describe("ObservationRow — registry-driven label + summary", () => {
  afterEachCleanup();

  it("scrotal_circumference renders a friendly label, not the raw enum", () => {
    render(
      <ObservationRow
        obs={obs({
          type: "scrotal_circumference" as PrismaObservation["type"],
          details: JSON.stringify({ measurement_cm: 42 }),
        })}
        onEdit={vi.fn()}
      />,
    );
    // The raw enum identifier must never reach the DOM.
    expect(screen.queryByText("scrotal_circumference")).toBeNull();
    expect(screen.queryByText("SCROTAL_CIRCUMFERENCE")).toBeNull();
    // The friendly label is rendered (case-insensitive — the badge uppercases).
    expect(screen.getByText(/scrotal circumference/i)).toBeInTheDocument();
    // The detail summary surfaces the measurement value, not "Details recorded".
    expect(screen.queryByText(/details recorded/i)).toBeNull();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("body_condition_score renders the score, not 'Details recorded'", () => {
    render(
      <ObservationRow
        obs={obs({
          type: "body_condition_score" as PrismaObservation["type"],
          details: JSON.stringify({ score: 5 }),
        })}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.queryByText("body_condition_score")).toBeNull();
    expect(screen.getByText(/body condition score/i)).toBeInTheDocument();
    expect(screen.queryByText(/details recorded/i)).toBeNull();
    // The BCS summary line carries the score, not a placeholder.
    expect(screen.getByText(/BCS:\s*5/i)).toBeInTheDocument();
  });

  it("temperament_score renders the score and a friendly label", () => {
    render(
      <ObservationRow
        obs={obs({
          type: "temperament_score" as PrismaObservation["type"],
          details: JSON.stringify({ score: 3 }),
        })}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.queryByText("temperament_score")).toBeNull();
    expect(screen.getByText(/temperament score/i)).toBeInTheDocument();
    expect(screen.queryByText(/details recorded/i)).toBeNull();
    // The temperament summary line carries the score.
    expect(screen.getByText(/Temperament:\s*3/i)).toBeInTheDocument();
  });

  it("existing types still render correctly (no regression on weighing)", () => {
    render(
      <ObservationRow
        obs={obs({
          type: "weighing",
          details: JSON.stringify({ weight_kg: 425 }),
        })}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText(/weighing/i)).toBeInTheDocument();
    expect(screen.getByText(/425 kg/)).toBeInTheDocument();
  });

  it("existing types still render correctly (no regression on camp_check)", () => {
    render(
      <ObservationRow
        obs={obs({
          type: "camp_check",
          details: JSON.stringify({ status: "All good" }),
        })}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText(/camp inspection/i)).toBeInTheDocument();
    expect(screen.getByText(/all good/i)).toBeInTheDocument();
  });
});

// vitest's `afterEach` global isn't auto-imported; wrap to keep top of file tidy.
function afterEachCleanup() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.afterEach === "function") {
    g.afterEach(() => cleanup());
  }
}
