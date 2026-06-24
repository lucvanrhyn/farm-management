// @vitest-environment jsdom
/**
 * TransactionModal — feed-mechanism taggers (wave/animal-mob-profitability).
 *
 * Contract pinned here:
 *   - The POST payload ALWAYS carries `animalId` + `campId` keys (empty → null),
 *     so untagged transactions explicitly clear, and tagged ones feed the
 *     per-animal / per-camp profitability views.
 *   - An injected `animalId` prop pre-tags the transaction (animal-detail
 *     Investment-tab fast-follow opens the SAME modal pre-tagged).
 *   - The camp <select> renders only when a non-empty `camps` list is passed;
 *     selecting a camp sends its `camp_id` as `campId`.
 *   - The value sent is the business TAG (what AnimalPicker.onChange yields),
 *     not a cuid.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// Mock AnimalPicker so the test doesn't hit /api/animals. The mock exposes a
// button that fires onChange with a business tag, mirroring the real component
// which yields `a.animalId` (the tag) on select.
vi.mock("@/components/observations/AnimalPicker", () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div>
      <span data-testid="picker-value">{value}</span>
      <button type="button" onClick={() => onChange("B042")}>
        pick-B042
      </button>
    </div>
  ),
}));

// Imported AFTER the mock is registered.
import TransactionModal from "../TransactionModal";

const incomeCategories = [{ id: "i1", name: "Wool", type: "income" }];
const expenseCategories = [{ id: "e1", name: "Feed", type: "expense" }];
const camps = [
  { camp_id: "C1", camp_name: "Camp North" },
  { camp_id: "C2", camp_name: "Camp South" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function lastPostBody() {
  expect(fetchMock).toHaveBeenCalled();
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse((init as RequestInit).body as string);
}

describe("TransactionModal taggers", () => {
  it("always sends animalId + campId keys (null when untagged)", async () => {
    render(
      <TransactionModal
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "100" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastPostBody();
    expect(body).toHaveProperty("animalId", null);
    expect(body).toHaveProperty("campId", null);
  });

  it("sends the picked animal TAG (not a cuid) when an animal is chosen", async () => {
    render(
      <TransactionModal
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "100" } });
    fireEvent.click(screen.getByText("pick-B042"));
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastPostBody().animalId).toBe("B042");
  });

  it("pre-tags from an injected animalId prop", () => {
    render(
      <TransactionModal
        animalId="B999"
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("picker-value").textContent).toBe("B999");
  });

  it("can clear an existing animal tag in edit mode (sends animalId: null)", async () => {
    const existing = {
      id: "t1",
      type: "expense",
      category: "Feed",
      amount: 100,
      date: "2026-06-01",
      description: "",
      animalId: "B042",
    };
    render(
      <TransactionModal
        transaction={existing}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    // Edit mode seeds the tag; a Clear affordance is offered.
    expect(screen.getByTestId("picker-value").textContent).toBe("B042");
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByTestId("picker-value").textContent).toBe("");

    fireEvent.click(screen.getByText("Save Changes"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(String(url)).toBe("/api/transactions/t1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(lastPostBody().animalId).toBeNull();
  });

  it("renders the camp <select> only when camps are supplied and sends camp_id", async () => {
    const { rerender } = render(
      <TransactionModal
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    // No camps → no camp option.
    expect(screen.queryByText("Camp North")).toBeNull();

    rerender(
      <TransactionModal
        camps={camps}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText("Camp North")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "100" } });
    // Select the camp by its display value; option value is the camp_id.
    const select = screen.getByText("Camp North").closest("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "C2" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastPostBody().campId).toBe("C2");
  });
});
