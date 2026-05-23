// @vitest-environment jsdom
/**
 * Issue #394 — EditModal pulls its per-type detail form from the unified
 * `OBSERVATION_REGISTRY`. Previously the modal's `TypeFields` dispatched
 * an internal switch that only matched 6 of the 23 persistence-canonical
 * types, falling through to a read-only key/value dump for the rest.
 *
 * This suite locks the per-type form rendering for three previously
 * uncovered types: `scrotal_circumference`, `body_condition_score`,
 * `temperament_score`. Each should expose an input shaped by the type's
 * known wire payload (cm measurement, 1–9 BCS score, 1–5 temperament
 * score) rather than the generic key/value dump.
 *
 * Existing editable types (weighing, treatment, health_issue,
 * camp_condition, reproduction, death) keep their behaviour — the
 * registry-driven dispatch routes through the same per-type form
 * components.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import type { PrismaObservation } from "@/lib/types";

import { EditModal } from "@/components/admin/observations-log/EditModal";

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

describe("EditModal — registry-driven per-type detail form", () => {
  afterEach(() => cleanup());

  it("scrotal_circumference renders a numeric measurement input pre-filled from details", () => {
    render(
      <EditModal
        obs={obs({
          type: "scrotal_circumference" as PrismaObservation["type"],
          details: JSON.stringify({ measurement_cm: 42 }),
        })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    // Heading and meta still rendered.
    expect(screen.getByText("Edit Observation")).toBeInTheDocument();
    // Friendly label rendered (may appear as both the meta-row type label
    // and the form-input label — at least one must be present).
    expect(screen.getAllByText(/scrotal circumference/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("scrotal_circumference")).toBeNull();
    // A numeric input carrying the cm value is present.
    const numericInputs = screen
      .getAllByRole("spinbutton")
      .filter((el) => (el as HTMLInputElement).type === "number");
    expect(numericInputs.length).toBeGreaterThan(0);
    expect((numericInputs[0] as HTMLInputElement).value).toBe("42");
  });

  it("body_condition_score renders an input pre-filled with the BCS score", () => {
    render(
      <EditModal
        obs={obs({
          type: "body_condition_score" as PrismaObservation["type"],
          details: JSON.stringify({ score: 5 }),
        })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/body condition score/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("body_condition_score")).toBeNull();
    // The value 5 reaches the form input (rendered as a number/select option).
    const matches = screen.getAllByDisplayValue(/^5$/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("temperament_score renders an input pre-filled with the temperament score", () => {
    render(
      <EditModal
        obs={obs({
          type: "temperament_score" as PrismaObservation["type"],
          details: JSON.stringify({ score: 3 }),
        })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/temperament score/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("temperament_score")).toBeNull();
    const matches = screen.getAllByDisplayValue(/^3$/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("weighing (existing editable type) still renders a weight input", () => {
    render(
      <EditModal
        obs={obs({
          type: "weighing",
          details: JSON.stringify({ weight_kg: 425 }),
        })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/weighing/i).length).toBeGreaterThan(0);
    const numericInputs = screen
      .getAllByRole("spinbutton")
      .filter((el) => (el as HTMLInputElement).type === "number");
    expect(numericInputs.length).toBeGreaterThan(0);
    // The 425 weight value is reflected in the input.
    expect((numericInputs[0] as HTMLInputElement).value).toBe("425");
  });
});
