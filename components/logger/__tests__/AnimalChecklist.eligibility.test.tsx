// @vitest-environment jsdom
/**
 * Issue #391 (W3 of PRD #389) — AnimalChecklist must gate invalid
 * (animal, action) checkboxes at the UI layer using the
 * `canPerformLoggerAction` predicate.
 *
 * Without this fix the farmer could tick "Calving" on a bull or
 * "Reproduction" on a lamb; the server would silently no-op or 500. This
 * suite pins the new contract:
 *
 *   1. A blocked checkbox is rendered with `disabled` set so the farmer
 *      physically cannot click it.
 *   2. The predicate's `reason` string is exposed through `title` +
 *      `aria-description` so the farmer (and screen reader) can see *why*
 *      the action is unavailable.
 *   3. Allowed checkboxes remain interactive — no regression on the happy
 *      path.
 *
 * Component-level mirror of `lib/logger/canPerformAction.test.ts`. Kept
 * separate so a wiring regression (predicate correct, component forgets to
 * apply `disabled`) shows up here, not as a Playwright failure later.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

afterEach(() => {
  cleanup();
});

// Minimal animal fixtures — `AnimalChecklist` only reads `animal_id`,
// `category`, `name`, `sex` to evaluate the predicate + render rows.
const ANIMALS = [
  // Bull — calving must be disabled (wrong sex).
  {
    animal_id: "BB-B001",
    category: "Bull" as const,
    sex: "Male" as const,
    name: "Brutus",
  },
  // Cow — every action allowed.
  {
    animal_id: "BB-C001",
    category: "Cow" as const,
    sex: "Female" as const,
    name: "Bessie",
  },
  // Calf — both calving (juvenile) AND reproduction (sexually immature) blocked.
  {
    animal_id: "BB-CF001",
    category: "Calf" as const,
    sex: "Female" as const,
    name: null,
  },
  // Maiden Ewe — calving blocked (never lambed), reproduction allowed.
  {
    animal_id: "BB-ML001",
    category: "Maiden Ewe" as const,
    sex: "Female" as const,
    name: null,
  },
];

function getButton(
  container: HTMLElement,
  animalId: string,
  ariaLabel: string,
): HTMLButtonElement | null {
  const row = Array.from(
    container.querySelectorAll<HTMLDivElement>("[data-animal-row]"),
  ).find((el) => el.textContent?.includes(animalId));
  if (!row) return null;
  return row.querySelector<HTMLButtonElement>(
    `button[aria-label="${ariaLabel}"]`,
  );
}

describe("AnimalChecklist eligibility gating (#391)", () => {
  it("Bull row: Calving button is disabled with a reason", async () => {
    const { default: AnimalChecklist } = await import(
      "@/components/logger/AnimalChecklist"
    );

    const { container } = render(
      <AnimalChecklist
        campId="camp-1"
        onFlag={vi.fn()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animals={ANIMALS as any}
        species="cattle"
      />,
    );

    const btn = getButton(container, "BB-B001", "Calving");
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
    expect(btn!.getAttribute("aria-disabled")).toBe("true");
    // Reason must be exposed for the farmer + screen reader.
    const title = btn!.getAttribute("title");
    const ariaDescription = btn!.getAttribute("aria-description");
    expect(title).toBeTruthy();
    expect(title!.toLowerCase()).toContain("female");
    expect(ariaDescription).toBe(title);
  });

  it("Bull row: Reproduction button stays enabled (bulls do mate)", async () => {
    const { default: AnimalChecklist } = await import(
      "@/components/logger/AnimalChecklist"
    );

    const { container } = render(
      <AnimalChecklist
        campId="camp-1"
        onFlag={vi.fn()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animals={ANIMALS as any}
        species="cattle"
      />,
    );

    const btn = getButton(container, "BB-B001", "Repro");
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(false);
    expect(btn!.getAttribute("aria-disabled")).toBe("false");
  });

  it("Cow row: every action is enabled (happy-path)", async () => {
    const { default: AnimalChecklist } = await import(
      "@/components/logger/AnimalChecklist"
    );

    const { container } = render(
      <AnimalChecklist
        campId="camp-1"
        onFlag={vi.fn()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animals={ANIMALS as any}
        species="cattle"
      />,
    );

    for (const label of ["Health", "Weigh", "Treat", "Move", "Calving", "Repro", "Death"]) {
      const btn = getButton(container, "BB-C001", label);
      expect(btn, `expected button ${label} to render for Cow`).not.toBeNull();
      expect(btn!.disabled, `expected ${label} enabled on Cow`).toBe(false);
    }
  });

  it("Calf row: both Calving AND Reproduction are disabled", async () => {
    const { default: AnimalChecklist } = await import(
      "@/components/logger/AnimalChecklist"
    );

    const { container } = render(
      <AnimalChecklist
        campId="camp-1"
        onFlag={vi.fn()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animals={ANIMALS as any}
        species="cattle"
      />,
    );

    const calving = getButton(container, "BB-CF001", "Calving");
    const repro = getButton(container, "BB-CF001", "Repro");
    expect(calving).not.toBeNull();
    expect(calving!.disabled).toBe(true);
    expect(calving!.getAttribute("title")).toContain("Calf");
    expect(repro).not.toBeNull();
    expect(repro!.disabled).toBe(true);
    expect(repro!.getAttribute("title")).toContain("Calf");
  });

  it("Maiden Ewe row (sheep): Calving disabled, Reproduction enabled", async () => {
    const { default: AnimalChecklist } = await import(
      "@/components/logger/AnimalChecklist"
    );

    const { container } = render(
      <AnimalChecklist
        campId="camp-1"
        onFlag={vi.fn()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animals={ANIMALS as any}
        species="sheep"
      />,
    );

    const lambing = getButton(container, "BB-ML001", "Lambing");
    const repro = getButton(container, "BB-ML001", "Repro");
    expect(lambing).not.toBeNull();
    expect(lambing!.disabled).toBe(true);
    expect(lambing!.getAttribute("title")).toContain("Maiden Ewe");
    expect(repro).not.toBeNull();
    expect(repro!.disabled).toBe(false);
  });

  it("disabled buttons do not fire onFlag when clicked", async () => {
    const { default: AnimalChecklist } = await import(
      "@/components/logger/AnimalChecklist"
    );
    const onFlag = vi.fn();

    const { container } = render(
      <AnimalChecklist
        campId="camp-1"
        onFlag={onFlag}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animals={ANIMALS as any}
        species="cattle"
      />,
    );

    const bullCalving = getButton(container, "BB-B001", "Calving");
    expect(bullCalving).not.toBeNull();
    bullCalving!.click();
    expect(onFlag).not.toHaveBeenCalled();
  });
});
