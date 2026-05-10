/**
 * @vitest-environment jsdom
 *
 * Wave A2 — CampDetailPanel must filter the per-camp roster by the active
 * farm mode AND status:Active.
 *
 * Bug context (audit-2026-05-10): the panel called
 *   /api/animals?camp=<id>&status=all
 * which (a) drops mode entirely, leaking cross-species rows into a per-species
 * view, and (b) sends `status=all` which DISABLES the API's default Active
 * filter, leaking inactive/sold/dead rows into the table.
 *
 * Contract this test enforces:
 *   1. Fetch URL contains `species=<mode>` for the active mode.
 *   2. Fetch URL contains `status=Active` (explicit, not relying on default).
 *   3. Fetch URL does NOT contain `status=all` (regression guard).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Mock useFarmModeSafe so the component renders without a provider and
// receives a deterministic mode. The test rerenders for each mode below.
const mockMode = vi.hoisted(() => ({ current: "cattle" as "cattle" | "sheep" | "game" }));
vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => ({
    mode: mockMode.current,
    setMode: () => {},
    enabledModes: ["cattle"] as const,
    isMultiMode: false,
  }),
}));

import CampDetailPanel from "@/components/dashboard/CampDetailPanel";
import type { Camp } from "@/lib/types";

const fixtureCamp: Camp = {
  camp_id: "C1",
  camp_name: "Camp One",
  size_hectares: 10,
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function lastFetchUrl(): string {
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const first = calls[0]![0];
  return typeof first === "string" ? first : (first as URL).toString();
}

describe("CampDetailPanel — per-species + Active filter", () => {
  it("includes species=<mode> in the fetch URL", () => {
    mockMode.current = "sheep";
    render(
      <CampDetailPanel
        campId="C1"
        camp={fixtureCamp}
        onClose={() => {}}
        onSelectAnimal={() => {}}
      />,
    );
    expect(lastFetchUrl()).toContain("species=sheep");
  });

  it("includes status=Active in the fetch URL (explicit, not relying on default)", () => {
    mockMode.current = "cattle";
    render(
      <CampDetailPanel
        campId="C1"
        camp={fixtureCamp}
        onClose={() => {}}
        onSelectAnimal={() => {}}
      />,
    );
    expect(lastFetchUrl()).toContain("status=Active");
  });

  it("does NOT include status=all in the fetch URL (regression guard)", () => {
    mockMode.current = "cattle";
    render(
      <CampDetailPanel
        campId="C1"
        camp={fixtureCamp}
        onClose={() => {}}
        onSelectAnimal={() => {}}
      />,
    );
    expect(lastFetchUrl()).not.toContain("status=all");
  });

  it("preserves the camp filter alongside species + status", () => {
    mockMode.current = "game";
    render(
      <CampDetailPanel
        campId="C42"
        camp={fixtureCamp}
        onClose={() => {}}
        onSelectAnimal={() => {}}
      />,
    );
    const url = lastFetchUrl();
    expect(url).toContain("camp=C42");
    expect(url).toContain("species=game");
    expect(url).toContain("status=Active");
  });
});
