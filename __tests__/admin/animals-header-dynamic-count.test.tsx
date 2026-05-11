// @vitest-environment jsdom
/**
 * __tests__/admin/animals-header-dynamic-count.test.tsx
 *
 * Issue #205 — the admin/animals header used to read
 *   "Showing first {N} · scroll or Load more to see the rest"
 * with N rendered SSR-side from `animals.length` in page.tsx. That number
 * never updated when AnimalsTable streamed the next cursor window from
 * /api/animals, so a tenant with 200 cattle saw a stale "50" forever.
 *
 * Worse, on a cattle-only-mode farm with 81 cattle Active + 20 other-species
 * Active, the page rendered "Showing first 81 …" with no hint of the 20
 * non-cattle animals — a multi-species farmer thought their data was lost.
 *
 * This suite locks in two contracts on `AnimalsTable`:
 *
 *   1. The header count text lives in the client component and reacts to
 *      Load more — "Showing X of {totalForSpecies}" where X grows as
 *      streamed batches arrive.
 *
 *   2. When `crossSpeciesActiveTotal` is provided and differs from the
 *      species-scoped total, the header also surfaces the cross-species
 *      reconciliation number so multi-species tenants see both numbers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/delta-livestock/admin/animals",
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

function fakeAnimals(start: number, count: number): AnyAnimal[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `C${String(start + i).padStart(4, "0")}`;
    return {
      id,
      animalId: id,
      name: null,
      sex: i % 2 === 0 ? "Female" : "Male",
      dateOfBirth: "2020-01-01",
      breed: "Bonsmara",
      category: "cow",
      currentCamp: "camp-1",
      status: "Active",
      motherId: null,
      fatherId: null,
      species: "cattle",
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

describe("<AnimalsTable /> — dynamic header count (issue #205)", () => {
  it("renders 'Showing 50 of 81 cattle' when SSR hands 50 rows and species total is 81", async () => {
    const { default: AnimalsTable } = await import(
      "@/components/admin/AnimalsTable"
    );

    render(
      <AnimalsTable
        animals={fakeAnimals(1, 50) as never}
        camps={[{ camp_id: "camp-1", camp_name: "Camp 1" }]}
        farmSlug="delta-livestock"
        initialNextCursor="C0050"
        species="cattle"
        speciesTotal={81}
      />,
    );

    // Header text shows "Showing {loaded} of {speciesTotal} {species}"
    expect(
      screen.getByText(/Showing\s+50\s+of\s+81\s+cattle/i),
    ).toBeTruthy();
  });

  it("updates the header to 'Showing 75 of 81 cattle' after Load more streams 25 rows", async () => {
    const { default: AnimalsTable } = await import(
      "@/components/admin/AnimalsTable"
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: fakeAnimals(51, 25),
        nextCursor: null,
        hasMore: false,
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock;

    render(
      <AnimalsTable
        animals={fakeAnimals(1, 50) as never}
        camps={[{ camp_id: "camp-1", camp_name: "Camp 1" }]}
        farmSlug="delta-livestock"
        initialNextCursor="C0050"
        species="cattle"
        speciesTotal={81}
      />,
    );

    // Sanity: before click the header reads 50
    expect(
      screen.getByText(/Showing\s+50\s+of\s+81\s+cattle/i),
    ).toBeTruthy();

    const btn = screen.getByRole("button", { name: /load more/i });
    await act(async () => {
      fireEvent.click(btn);
      // let the async fetch resolve + React commit
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByText(/Showing\s+75\s+of\s+81\s+cattle/i),
    ).toBeTruthy();
  });

  it("renders the cross-species reconciliation when crossSpeciesActiveTotal differs from speciesTotal", async () => {
    const { default: AnimalsTable } = await import(
      "@/components/admin/AnimalsTable"
    );

    render(
      <AnimalsTable
        animals={fakeAnimals(1, 50) as never}
        camps={[{ camp_id: "camp-1", camp_name: "Camp 1" }]}
        farmSlug="delta-livestock"
        initialNextCursor="C0050"
        species="cattle"
        speciesTotal={81}
        crossSpeciesActiveTotal={101}
      />,
    );

    // Per-species header still shows the loaded/total pair
    expect(
      screen.getByText(/Showing\s+50\s+of\s+81\s+cattle/i),
    ).toBeTruthy();
    // Reconciliation surfaces the cross-species Active total alongside
    expect(
      screen.getByText(/101\s+total\s+Active\s+across\s+species/i),
    ).toBeTruthy();
  });

  it("omits the reconciliation line on single-species farms (crossSpeciesActiveTotal === speciesTotal)", async () => {
    const { default: AnimalsTable } = await import(
      "@/components/admin/AnimalsTable"
    );

    render(
      <AnimalsTable
        animals={fakeAnimals(1, 50) as never}
        camps={[{ camp_id: "camp-1", camp_name: "Camp 1" }]}
        farmSlug="delta-livestock"
        initialNextCursor="C0050"
        species="cattle"
        speciesTotal={81}
        crossSpeciesActiveTotal={81}
      />,
    );

    expect(
      screen.getByText(/Showing\s+50\s+of\s+81\s+cattle/i),
    ).toBeTruthy();
    expect(screen.queryByText(/total Active across species/i)).toBeNull();
  });
});
