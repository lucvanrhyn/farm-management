// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import MtnCoverageLayer, {
  PLACEHOLDER_TILE,
  MTN_COVERAGE_AVAILABLE,
} from "@/components/map/layers/MtnCoverageLayer";

// react-map-gl/mapbox needs a Mapbox map context that jsdom can't provide.
// Stub Source/Layer so that *if* the component mounts a raster source (the
// bug), the test still runs and we can assert it did NOT — i.e. the guard
// renders null instead of a data-URI raster source.
vi.mock("react-map-gl/mapbox", () => ({
  Source: ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="mtn-source" data-tiles={JSON.stringify(props.tiles)}>
      {children as React.ReactNode}
    </div>
  ),
  Layer: () => <div data-testid="mtn-layer" />,
}));

/**
 * Regression: production triage P2.1 (wave/181). Mapbox GL JS raster sources
 * cannot decode SVG data URLs ("The source image could not be decoded… SVGs
 * are not supported"). The placeholder tile must be a PNG/JPG/WebP. Lock that
 * contract in here so a future "make it sharper / make it themable" diff that
 * swaps back to SVG fails CI instead of resurfacing 141 console errors per
 * page load in production.
 */
describe("MtnCoverageLayer placeholder tile", () => {
  it("is a PNG data URL (Mapbox raster sources cannot decode SVG)", () => {
    expect(PLACEHOLDER_TILE).toMatch(/^data:image\/png;base64,/);
    expect(PLACEHOLDER_TILE).not.toMatch(/svg/i);
  });

  it("is a non-empty base64 payload", () => {
    const base64 = PLACEHOLDER_TILE.replace(/^data:image\/png;base64,/, "");
    expect(base64.length).toBeGreaterThan(40);
    // PNG magic bytes encoded as base64 prefix: `iVBORw0KGgo` = `\x89PNG\r\n\x1a\n`.
    expect(base64.startsWith("iVBORw0KGgo")).toBe(true);
  });

  it("MTN_COVERAGE_AVAILABLE reflects whether a real tile URL is configured", () => {
    // Test env should not configure NEXT_PUBLIC_MTN_TILES_URL → placeholder mode.
    expect(MTN_COVERAGE_AVAILABLE).toBe(false);
  });
});

/**
 * Issue #284 (PRD #279). When NO real tile-source URL is configured the layer
 * must render nothing — not a Mapbox raster <Source> whose tile template is a
 * `data:image/png;base64,...` URI. Mapbox treats the data-URI as an XYZ tile
 * template and fires one failed fetch per tile per redraw, flooding the
 * console/network during map use, pan/zoom and draw mode. The existing
 * LayerToggle "unavailable" affordance (MTN_COVERAGE_AVAILABLE === false)
 * already communicates the missing-data state, so the layer body is dead
 * weight that only causes noise.
 */
describe("MtnCoverageLayer no-URL guard (#284)", () => {
  it("renders null when no real tile-source URL is configured (no data-URI raster source)", () => {
    // Test env does not set NEXT_PUBLIC_MTN_TILES_URL → MTN_COVERAGE_AVAILABLE false.
    expect(MTN_COVERAGE_AVAILABLE).toBe(false);

    const { container, queryByTestId } = render(<MtnCoverageLayer />);

    // No raster source mounted at all → no XYZ fetches against a data-URI.
    expect(queryByTestId("mtn-source")).toBeNull();
    expect(queryByTestId("mtn-layer")).toBeNull();
    expect(container).toBeEmptyDOMElement();
    cleanup();
  });
});
