// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

import {
  PLACEHOLDER_TILE,
  MTN_COVERAGE_AVAILABLE,
} from "@/components/map/layers/MtnCoverageLayer";

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
