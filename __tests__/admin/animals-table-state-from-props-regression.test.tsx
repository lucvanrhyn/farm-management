// @vitest-environment jsdom
/**
 * Codex stress-test 2026-05-27 — Trio species-context bug.
 *
 * Repro: Cattle toggle is active, header reads "Showing 0 of 875 cattle",
 * body renders "No animals found." even though SSR injected 50 cattle
 * rows on the latest render.
 *
 * Root cause: `AnimalsTable.tsx:94`
 *
 *     const [animals, setAnimals] = useState<PrismaAnimal[]>(initialAnimals);
 *
 * `useState(initialAnimals)` reads the prop ONCE on mount. After
 * `router.refresh()` re-renders the page Server Component with the new
 * mode cookie, the new SSR delivers fresh `initialAnimals` + `species` +
 * `speciesTotal` props, but the AnimalsTable instance is NOT remounted —
 * `useState` keeps the prior species' rows in local state. The header
 * shows the new species' count (`speciesTotal` is a prop, not state) but
 * the table body renders against stale rows from the prior species.
 *
 * Memory: feedback-react-state-from-props.md — exact same anti-pattern
 * already fixed in `lib/farm-mode.tsx` (FarmModeProvider) via the
 * React-blessed useState-pair pattern (`lastFarmSlug` sentinel). Same
 * fix needed here: track previous `species` in state and reset
 * `animals` synchronously during render when it changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b-boerdery/admin/animals",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => ({ mode: "cattle" }),
}));

vi.mock("@/components/admin/finansies/AnimalActions", () => ({
  default: () => null,
}));

type AnyAnimal = {
  id: string;
  animalId: string;
  name: string | null;
  sex: string;
  dateOfBirth: string | null;
  breed: string | null;
  category: string;
  currentCamp: string;
  status: string;
  motherId: string | null;
  fatherId: string | null;
  species: string;
  dateAdded: string;
  mobId: string | null;
  deceasedAt: string | null;
};

function fakeAnimals(species: "cattle" | "sheep", count: number): AnyAnimal[] {
  const prefix = species === "cattle" ? "BB-C" : "BB-S";
  const category = species === "cattle" ? "Cow" : "Ewe";
  return Array.from({ length: count }, (_, i) => {
    const id = `${prefix}${String(i + 1).padStart(4, "0")}`;
    return {
      id,
      animalId: id,
      name: null,
      sex: "Female",
      dateOfBirth: "2020-01-01",
      breed: null,
      category,
      currentCamp: "A",
      status: "Active",
      motherId: null,
      fatherId: null,
      species,
      dateAdded: "2024-01-01",
      mobId: null,
      deceasedAt: null,
    };
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AnimalsTable — animals[] re-syncs when initialAnimals prop changes (router.refresh after ModeSwitcher)", () => {
  it("renders the NEW species' rows after the props change, not the prior species' stale rows", async () => {
    const { default: AnimalsTable } = await import(
      "@/components/admin/AnimalsTable"
    );

    // First render: SSR delivered 0 sheep (e.g. trio-b's sheep is empty).
    const { rerender } = render(
      <AnimalsTable
        animals={fakeAnimals("sheep", 0) as never}
        camps={[{ camp_id: "A", camp_name: "Camp A" }]}
        farmSlug="trio-b-boerdery"
        species="sheep"
        speciesTotal={0}
      />,
    );

    expect(screen.getByText(/showing 0 of 0/i)).toBeTruthy();

    // User clicks Cattle in the ModeSwitcher. ModeSwitcher writes the
    // cookie and calls router.refresh(). The page Server Component
    // re-renders with mode=cattle, SSR fetches 50 cattle rows and
    // speciesTotal=875. AnimalsTable receives fresh props but is NOT
    // remounted.
    rerender(
      <AnimalsTable
        animals={fakeAnimals("cattle", 50) as never}
        camps={[{ camp_id: "A", camp_name: "Camp A" }]}
        farmSlug="trio-b-boerdery"
        species="cattle"
        speciesTotal={875}
      />,
    );

    // Header reflects the new species count (driven by props, not state):
    expect(screen.getByText(/showing .* of 875 cattle/i)).toBeTruthy();

    // BUG: body still renders zero rows because `useState(initialAnimals)`
    // didn't re-sync to the new prop value. This assertion is what fails
    // under the current implementation — locking the regression class.
    expect(screen.queryByText(/no animals found/i)).toBeNull();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });
});
