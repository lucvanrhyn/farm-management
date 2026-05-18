// @vitest-environment jsdom
/**
 * Issue #322 (PRD #318 Wave R5) — geometry-less camps must not silently
 * vanish from the tenant map view.
 *
 * Root cause: `buildCampGeoJSON()` does `if (!camp.geojson) continue;`, so a
 * camp without a drawn boundary never becomes a map feature and there is no
 * non-map way to reach it. On real tenants the MAJORITY of camps lack
 * boundaries (Basson 8/9, Trio 16/19), making them unreachable.
 *
 * Design (HITL-locked on #322): a non-map LIST of the geometry-less camps
 * rendered as a sibling panel to <FarmMap>, each row openable to the same
 * camp destination a map polygon click reaches, plus a persistent setup-state
 * CTA showing the missing-boundary COUNT routing to the draw/edit flow.
 *
 * Three guards pin the contract:
 *   1. `selectCampsMissingGeometry` returns EXACTLY the geometry-less camps
 *      (predicate is pure, leaves geometry-bearing camps for the map layer).
 *   2. The fallback component lists every geometry-less camp, each row reaches
 *      the same camp destination + fires the onCampClick selection contract;
 *      geometry-bearing camps are NOT listed.
 *   3. The CTA shows the correct missing-boundary count and routes to the
 *      draw/edit boundary flow.
 *
 * `buildCampGeoJSON` behaviour for geometry-bearing camps stays identical —
 * pinned here so a future refactor of the selector can't regress the map.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import React from "react";
import {
  selectCampsMissingGeometry,
  buildCampGeoJSON,
  type CampData,
} from "@/components/map/layers/_camp-colors";
import CampPresenceFallback from "@/components/map/CampPresenceFallback";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mkCamp(id: string, name: string, geojson?: string): CampData {
  return {
    camp: {
      camp_id: id,
      camp_name: name,
      size_hectares: 12,
      water_source: "Borehole",
      geojson,
      color: "#abc123",
    },
    stats: { total: 0, byCategory: {} },
    grazing: "Good",
  };
}

const POLY =
  '{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}';

// Mirrors the real tenant skew: most camps lack boundaries.
const campData: CampData[] = [
  mkCamp("c1", "Rivier", POLY), // has geometry → stays on map
  mkCamp("c2", "Koppie"), // missing
  mkCamp("c3", "Vlakte"), // missing
  mkCamp("c4", "Dam", POLY), // has geometry → stays on map
  mkCamp("c5", "Bult"), // missing
];

describe("selectCampsMissingGeometry — pure predicate (#322 guard 1)", () => {
  it("returns exactly the camps whose geojson is missing", () => {
    const missing = selectCampsMissingGeometry(campData);
    expect(missing.map((d) => d.camp.camp_id).sort()).toEqual([
      "c2",
      "c3",
      "c5",
    ]);
  });

  it("treats empty-string and undefined geojson as missing", () => {
    const data = [mkCamp("a", "A", ""), mkCamp("b", "B", undefined)];
    expect(selectCampsMissingGeometry(data).map((d) => d.camp.camp_id)).toEqual(
      ["a", "b"],
    );
  });

  it("leaves geometry-bearing camps untouched in buildCampGeoJSON (no map regression)", () => {
    const fc = buildCampGeoJSON(campData, "grazing");
    // Only the 2 camps WITH geojson become features — unchanged behaviour.
    const ids = fc.features.map((f) => f.properties?.campId).sort();
    expect(ids).toEqual(["c1", "c4"]);
  });
});

describe("CampPresenceFallback — list panel + CTA (#322 guards 2 & 3)", () => {
  it("lists every geometry-less camp and NOT geometry-bearing ones", () => {
    const { getByTestId, queryByText } = render(
      <CampPresenceFallback
        campData={campData}
        farmSlug="basson"
        onCampClick={() => {}}
      />,
    );
    const panel = getByTestId("camp-presence-fallback");
    expect(within(panel).getByText("Koppie")).toBeTruthy();
    expect(within(panel).getByText("Vlakte")).toBeTruthy();
    expect(within(panel).getByText("Bult")).toBeTruthy();
    // Camps with geometry are on the map, not in the fallback list.
    expect(queryByText("Rivier")).toBeNull();
    expect(queryByText("Dam")).toBeNull();
  });

  it("each row reaches the same camp destination a map polygon click does", () => {
    const { getByTestId } = render(
      <CampPresenceFallback
        campData={campData}
        farmSlug="basson"
        onCampClick={() => {}}
      />,
    );
    const row = getByTestId("camp-presence-row-c2");
    const link = within(row).getByRole("link");
    // Matches CampPopupContent's "View Details" destination contract.
    expect(link.getAttribute("href")).toBe("/basson/dashboard/camp/c2");
  });

  it("opening a row fires the onCampClick selection contract with the camp id", () => {
    const onCampClick = vi.fn();
    const { getByTestId } = render(
      <CampPresenceFallback
        campData={campData}
        farmSlug="basson"
        onCampClick={onCampClick}
      />,
    );
    fireEvent.click(getByTestId("camp-presence-row-c5"));
    expect(onCampClick).toHaveBeenCalledWith("c5");
  });

  it("CTA shows the correct missing-boundary count and routes to the draw/edit flow", () => {
    const { getByTestId } = render(
      <CampPresenceFallback
        campData={campData}
        farmSlug="basson"
        onCampClick={() => {}}
      />,
    );
    const cta = getByTestId("camp-presence-cta");
    // 3 of the 5 camps lack boundaries.
    expect(cta.textContent).toMatch(/3/);
    const ctaLink = within(cta).getByRole("link");
    expect(ctaLink.getAttribute("href")).toBe("/basson/admin/map");
  });

  it("renders nothing when every camp already has boundary geometry", () => {
    const allDrawn = [mkCamp("x", "X", POLY), mkCamp("y", "Y", POLY)];
    const { container } = render(
      <CampPresenceFallback
        campData={allDrawn}
        farmSlug="basson"
        onCampClick={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
