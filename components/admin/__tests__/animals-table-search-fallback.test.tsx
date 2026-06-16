// @vitest-environment jsdom
/**
 * Issue #425 — Admin Animals search must fall back to a full-herd query when
 * the user types an ID that lives past the SSR-hydrated batch.
 *
 * Pre-#425: `AnimalsTable` filtered the already-loaded `animals` array (SSR's
 * first PAGE_SIZE = 50, plus any Load-more pages). On a 101-animal herd, a
 * search for the 101st animal returned "0 animals found" while the header
 * still read "Showing 50 of 101" — the farmer concluded the record was lost.
 *
 * Fix: when the local subset returns zero matches AND the loaded count is
 * less than the species total, fire `/api/animals?search=<q>` and render
 * those rows in the same table layout. Surface a "Searched full herd" hint
 * so the user knows which mode produced the result. Local matches still
 * render instantly with no network call.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
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
  status: PrismaAnimal["status"] = "Active",
  overrides: Partial<PrismaAnimal> = {},
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
    ...overrides,
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

const HINT_TEXT = /searched full herd/i;

function typeSearch(value: string) {
  // Redesign placeholder: "Search by ID, camp, mob…" (the search index now
  // also covers camp + mob names, so the placeholder is truthful).
  const input = screen.getByPlaceholderText(
    /search by id/i,
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

describe("AnimalsTable — remote search fallback (#425)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires /api/animals?search= when local match returns zero and more rows exist", async () => {
    // SSR'd batch holds 50 cattle (BB-001..BB-050). The herd total is 101.
    const animals = Array.from({ length: 50 }, (_, i) =>
      makeAnimal(`BB-${String(i + 1).padStart(3, "0")}`),
    );
    const remoteHit = makeAnimal("BB-101", "Active", { name: "Daisy" });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [remoteHit],
        nextCursor: null,
        hasMore: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AnimalsTable
        animals={animals}
        camps={CAMPS}
        farmSlug="basson-boerdery"
        species="cattle"
        speciesTotal={101}
        initialNextCursor="BB-050"
      />,
    );

    act(() => {
      typeSearch("BB-101");
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((c) => {
        const url = String(c[0]);
        return url.includes("/api/animals") && url.includes("search=BB-101");
      });
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    // Remote result is rendered in the same table.
    await waitFor(() => {
      expect(screen.getByText("BB-101")).toBeInTheDocument();
    });
  });

  it("does NOT fire fetch when the local subset already contains a match (fast-path)", async () => {
    const animals = Array.from({ length: 50 }, (_, i) =>
      makeAnimal(`BB-${String(i + 1).padStart(3, "0")}`),
    );

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AnimalsTable
        animals={animals}
        camps={CAMPS}
        farmSlug="basson-boerdery"
        species="cattle"
        speciesTotal={101}
        initialNextCursor="BB-050"
      />,
    );

    act(() => {
      typeSearch("BB-025");
    });

    // Allow any effects to settle.
    await new Promise((r) => setTimeout(r, 50));

    const searchCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("search="),
    );
    expect(searchCalls.length).toBe(0);

    // Hint is NOT shown for local matches.
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
  });

  it("does NOT fire fetch when everything is already loaded (loaded === total)", async () => {
    // 30 animals loaded, total is 30 — there's nothing more to find remotely.
    const animals = Array.from({ length: 30 }, (_, i) =>
      makeAnimal(`BB-${String(i + 1).padStart(3, "0")}`),
    );

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AnimalsTable
        animals={animals}
        camps={CAMPS}
        farmSlug="basson-boerdery"
        species="cattle"
        speciesTotal={30}
        initialNextCursor={null}
      />,
    );

    act(() => {
      typeSearch("ZZ-999");
    });

    await new Promise((r) => setTimeout(r, 50));

    const searchCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("search="),
    );
    expect(searchCalls.length).toBe(0);
  });

  it('renders "Searched full herd" hint after the fallback fires', async () => {
    const animals = Array.from({ length: 50 }, (_, i) =>
      makeAnimal(`BB-${String(i + 1).padStart(3, "0")}`),
    );
    const remoteHit = makeAnimal("BB-101");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [remoteHit],
        nextCursor: null,
        hasMore: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AnimalsTable
        animals={animals}
        camps={CAMPS}
        farmSlug="basson-boerdery"
        species="cattle"
        speciesTotal={101}
        initialNextCursor="BB-050"
      />,
    );

    act(() => {
      typeSearch("BB-101");
    });

    await waitFor(() => {
      expect(screen.getByText(HINT_TEXT)).toBeInTheDocument();
    });
  });
});
