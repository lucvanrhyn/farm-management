// @vitest-environment jsdom
/**
 * #368 — Shared ModalHeader with X close button.
 *
 * Contract this test pins:
 *
 *   1. ModalHeader renders the supplied title and a visible X close
 *      button (`aria-label="Close"`, so keyboard/screen-reader users can
 *      reach it). Before #368, DeathModal and MobMoveModal had only a
 *      drag handle — no close affordance at all.
 *
 *   2. Clicking the X fires `onClose` exactly once.
 *
 *   3. Pressing the Escape key fires `onClose`. The listener is a single
 *      keydown handler owned by ModalHeader — modals that adopt it do not
 *      register their own Escape listener, so there is no double-fire.
 *
 *   4. The Escape listener is removed on unmount — a closed/unmounted
 *      modal must not keep firing `onClose` on stray Escape presses.
 *
 * Without this contract the close affordance is bespoke per-modal and
 * two of the three logger modals ship with no X at all.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import React from "react";

import ModalHeader from "@/components/ui/ModalHeader";
import DeathModal from "@/components/logger/DeathModal";
import MobMoveModal from "@/components/logger/MobMoveModal";
import TransactionModal from "@/components/admin/finansies/TransactionModal";

afterEach(() => {
  cleanup();
});

describe("ModalHeader (#368)", () => {
  it("renders the title and a visible X close button", () => {
    render(<ModalHeader title="Record Death" onClose={vi.fn()} />);

    expect(screen.getByText("Record Death")).not.toBeNull();
    const closeBtn = screen.getByRole("button", { name: /close/i });
    expect(closeBtn).not.toBeNull();
  });

  it("fires onClose exactly once when the X is clicked", () => {
    const onClose = vi.fn();
    render(<ModalHeader title="Move Mob" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when the Escape key is pressed", () => {
    const onClose = vi.fn();
    render(<ModalHeader title="New Transaction" onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClose for non-Escape keys", () => {
    const onClose = vi.fn();
    render(<ModalHeader title="New Transaction" onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "a" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes the Escape listener on unmount (no stray fires)", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ModalHeader title="New Transaction" onClose={onClose} />,
    );

    unmount();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Adoption tests — the three modals named in #368 must now expose the
 * shared X close affordance + Escape-to-close. Before #368 DeathModal and
 * MobMoveModal had no X at all.
 */
describe("DeathModal adopts ModalHeader (#368)", () => {
  const baseProps = {
    isOpen: true,
    animalId: "C-042",
    causes: ["Disease", "Predator"],
    onSubmit: vi.fn(),
  };

  it("renders a visible X close button in the header", () => {
    render(<DeathModal {...baseProps} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /close/i })).not.toBeNull();
  });

  it("fires onClose when the X is clicked", () => {
    const onClose = vi.fn();
    render(<DeathModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose on the Escape key", () => {
    const onClose = vi.fn();
    render(<DeathModal {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("MobMoveModal adopts ModalHeader (#368)", () => {
  const baseProps = {
    isOpen: true,
    mob: { id: "m1", name: "North Mob", animal_count: 12 },
    camps: [
      { camp_id: "c2", camp_name: "Camp 2" },
    ] as never,
    currentCampId: "c1",
    destCamp: "",
    onDestCampChange: vi.fn(),
    onConfirm: vi.fn(),
    isSubmitting: false,
  };

  it("renders a visible X close button in the header", () => {
    render(<MobMoveModal {...baseProps} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /close/i })).not.toBeNull();
  });

  it("fires onClose when the X is clicked", () => {
    const onClose = vi.fn();
    render(<MobMoveModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose on the Escape key", () => {
    const onClose = vi.fn();
    render(<MobMoveModal {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("TransactionModal adopts ModalHeader (#368)", () => {
  const baseProps = {
    incomeCategories: [{ id: "i1", name: "Animal Sales", type: "income" }],
    expenseCategories: [{ id: "e1", name: "Feed", type: "expense" }],
    onSaved: vi.fn(),
  };

  it("renders a visible X close button in the header", () => {
    render(<TransactionModal {...baseProps} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /close/i })).not.toBeNull();
  });

  it("fires onClose when the X is clicked", () => {
    const onClose = vi.fn();
    render(<TransactionModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose on the Escape key", () => {
    const onClose = vi.fn();
    render(<TransactionModal {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
