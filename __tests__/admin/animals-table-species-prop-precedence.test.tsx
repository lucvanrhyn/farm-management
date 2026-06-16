// @vitest-environment jsdom
/**
 * __tests__/admin/animals-table-species-prop-precedence.test.tsx
 *
 * Issue #323 (PRD #318, wave R6) — AnimalsTable category/taxonomy options
 * must derive from the explicit `species` route prop, NOT from the ambient
 * `useFarmModeSafe().mode` (localStorage/cookie-backed).
 *
 * Regression: /sheep/animals/page.tsx passes species="sheep", but the table
 * built its category filter from getSpeciesModule(mode). While the ambient
 * cookie was still "cattle", the Sheep Catalogue showed the cattle taxonomy
 * (Cow / Bull / Heifer / Calf / Ox) instead of the sheep one
 * (Ewe / Ram / Wether / Hogget / Lamb / …).
 *
 * Contract: the explicit route prop wins; ambient mode is only the fallback
 * when no `species` prop is supplied.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/delta-livestock/sheep/animals",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

// Ambient mode is still "cattle" (cookie not yet flipped) — the bug.
vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => ({ mode: "cattle" }),
}));

vi.mock("@/components/admin/finansies/AnimalActions", () => ({
  default: () => null,
}));

function fakeAnimals(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const id = `S${String(i + 1).padStart(4, "0")}`;
    return {
      id,
      animalId: id,
      name: null,
      sex: i % 2 === 0 ? "Female" : "Male",
      dateOfBirth: "2020-01-01",
      breed: "Merino",
      category: "Ewe",
      currentCamp: "camp-1",
      status: "Active",
      motherId: null,
      fatherId: null,
      species: "sheep",
      dateAdded: "2024-01-01",
      mobId: null,
      deceasedAt: null,
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<AnimalsTable /> — explicit species prop beats ambient mode (#323)", () => {
  it("renders the SHEEP category options when species='sheep' even though ambient mode is 'cattle'", async () => {
    const { default: AnimalsTable } = await import(
      "@/components/admin/AnimalsTable"
    );

    render(
      <AnimalsTable
        animals={fakeAnimals(3) as never}
        camps={[{ camp_id: "camp-1", camp_name: "Camp 1" }]}
        farmSlug="delta-livestock"
        species="sheep"
      />,
    );

    // Sheep taxonomy must be present in the category filter chip row
    // (the redesign replaced the native <select> with retro filter chips —
    // buttons whose accessible name is the category label).
    for (const cat of ["Ewe", "Ram", "Wether", "Hogget", "Lamb"]) {
      expect(
        screen.getByRole("button", { name: cat }),
      ).toBeTruthy();
    }

    // Cattle taxonomy must NOT leak in (the regression symptom).
    for (const cat of ["Cow", "Bull", "Heifer", "Calf", "Ox"]) {
      expect(
        screen.queryByRole("button", { name: cat }),
      ).toBeNull();
    }
  });

  it("falls back to ambient mode taxonomy when no species prop is supplied", async () => {
    const { default: AnimalsTable } = await import(
      "@/components/admin/AnimalsTable"
    );

    render(
      <AnimalsTable
        animals={fakeAnimals(3) as never}
        camps={[{ camp_id: "camp-1", camp_name: "Camp 1" }]}
        farmSlug="delta-livestock"
      />,
    );

    // Ambient mode is "cattle" — cattle taxonomy should render unchanged
    // (category filter chips, post-redesign).
    for (const cat of ["Cow", "Bull", "Heifer", "Calf", "Ox"]) {
      expect(
        screen.getByRole("button", { name: cat }),
      ).toBeTruthy();
    }
  });
});
