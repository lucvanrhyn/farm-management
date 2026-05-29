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
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
    notes: null,
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

  // Issue #492 — the free-text note round-trips: it is pre-filled from the
  // existing column, and a save PATCHes the edited value alongside `details`.
  describe("free-text notes (#492)", () => {
    it("pre-fills the notes textarea from obs.notes", () => {
      render(
        <EditModal
          obs={obs({ type: "weighing", details: JSON.stringify({ weight_kg: 100 }), notes: "lame ewe 402" })}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
        />,
      );
      const textarea = screen.getByLabelText(/notes/i) as HTMLTextAreaElement;
      expect(textarea.value).toBe("lame ewe 402");
    });

    it("PATCHes the edited note alongside details on save", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "o1", type: "weighing" }), { status: 200 }),
        );
      const onSaved = vi.fn();
      render(
        <EditModal
          obs={obs({ type: "weighing", details: JSON.stringify({ weight_kg: 100 }), notes: "old" })}
          onClose={vi.fn()}
          onSaved={onSaved}
          onDeleted={vi.fn()}
        />,
      );

      const textarea = screen.getByLabelText(/notes/i);
      fireEvent.change(textarea, { target: { value: "new note" } });
      fireEvent.click(screen.getByText("Save"));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/observations/o1");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.notes).toBe("new note");
      expect(typeof body.details).toBe("string");

      fetchMock.mockRestore();
    });

    it("sends notes:null when the textarea is cleared", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "o1", type: "weighing" }), { status: 200 }),
        );
      render(
        <EditModal
          obs={obs({ type: "weighing", details: JSON.stringify({ weight_kg: 100 }), notes: "remove me" })}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: "  " } });
      fireEvent.click(screen.getByText("Save"));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.notes).toBeNull();

      fetchMock.mockRestore();
    });
  });
});
