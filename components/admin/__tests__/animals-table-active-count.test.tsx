// @vitest-environment jsdom
/**
 * Issue #367 — the animals-list active tab's "N animals found" label must
 * agree with the "Showing X of Y" header.
 *
 * SSR hydrates the first PAGE_SIZE rows via `searchAnimals(..., includeDeceased:
 * true)` so the Deceased / All tabs have data. That batch therefore contains
 * deceased rows. Before this wave the header numerator (`loaded`) counted the
 * RAW hydrated batch (50, deceased included) while the "N found" label counted
 * the ACTIVE subset (49). The Trio list rendered "Showing 50 of 874" next to
 * "49 animals found" — two label scopes contradicting each other.
 *
 * This test pins the contract: on the Active tab, the header numerator and the
 * "N found" count both exclude deceased rows, so they agree.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { PrismaAnimal, Camp } from "@/lib/types";

vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => ({ mode: "cattle", isMultiMode: false }),
}));

vi.mock("@/components/admin/finansies/AnimalActions", () => ({
  default: () => null,
}));

import AnimalsTable from "../AnimalsTable";

function makeAnimal(
  id: string,
  status: PrismaAnimal["status"],
): PrismaAnimal {
  return {
    id,
    animalId: id,
    name: null,
    sex: "Female",
    dateOfBirth: null,
    breed: "Angus",
    category: "cow",
    currentCamp: "C1",
    status,
    species: "cattle",
    motherId: null,
    fatherId: null,
    mobId: null,
    registrationNumber: null,
    dateAdded: "2026-01-01",
    deceasedAt: status === "Deceased" ? "2026-02-01" : null,
    createdAt: "2026-01-01",
  };
}

const CAMPS: Camp[] = [
  {
    camp_id: "C1",
    camp_name: "Camp One",
    size_hectares: 10,
    water_source: "Borehole",
    geojson: null,
    notes: null,
    animal_count: 0,
  } as unknown as Camp,
];

describe("AnimalsTable — active-tab count agrees with header (#367)", () => {
  afterEach(() => {
    cleanup();
  });

  it("active-tab 'N found' count excludes deceased rows from the hydrated batch", () => {
    // 49 active + 1 deceased = 50 hydrated rows (the SSR includeDeceased batch).
    const animals: PrismaAnimal[] = [
      ...Array.from({ length: 49 }, (_, i) =>
        makeAnimal(`A${i}`, "Active"),
      ),
      makeAnimal("DEAD-1", "Deceased"),
    ];

    render(
      <AnimalsTable
        animals={animals}
        camps={CAMPS}
        farmSlug="trio"
        species="cattle"
        speciesTotal={874}
      />,
    );

    // "N found" label counts only the 49 active rows, not all 50.
    expect(screen.getByText("49 animals found")).toBeInTheDocument();
  });

  it("header 'Showing X' numerator and 'N found' label agree on the active tab", () => {
    const animals: PrismaAnimal[] = [
      ...Array.from({ length: 49 }, (_, i) =>
        makeAnimal(`A${i}`, "Active"),
      ),
      makeAnimal("DEAD-1", "Deceased"),
    ];

    render(
      <AnimalsTable
        animals={animals}
        camps={CAMPS}
        farmSlug="trio"
        species="cattle"
        speciesTotal={874}
      />,
    );

    const header = screen.getByTestId("animals-header-count");
    // The header must NOT count the deceased row in its numerator: the bug
    // was "Showing 50 of 874" next to "49 animals found".
    expect(header.textContent).not.toContain("Showing 50 of 874");
    expect(header.textContent).toContain("Showing 49 of 874");
    expect(screen.getByText("49 animals found")).toBeInTheDocument();
  });
});
