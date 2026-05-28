/**
 * @vitest-environment node
 *
 * Wave 466 (#466) — camp-colour normaliser.
 *
 * The camp identity colour flows into a Mapbox paint expression
 * `["to-color", ["get", "borderColor"]]` on the camp-outline layer. The
 * legacy guard used nullish-coalescing only (`camp.color ?? DEFAULT`), which
 * lets an empty string `""` (and whitespace-only / invalid garbage) slip
 * through to `to-color`, firing a "could not parse color" style-expression
 * error and mis-rendering the affected camps.
 *
 * `normaliseCampColor` is a pure guard: it maps null / undefined / empty /
 * whitespace-only / invalid values to the shared `DEFAULT_CAMP_COLOR`, and
 * passes a valid hex (lower- or upper-case) through unchanged.
 */
import { describe, it, expect } from "vitest";

import { normaliseCampColor } from "../_camp-colors";
import { DEFAULT_CAMP_COLOR } from "@/lib/camp-colors";

describe("normaliseCampColor", () => {
  it("maps null to the default camp colour", () => {
    expect(normaliseCampColor(null)).toBe(DEFAULT_CAMP_COLOR);
  });

  it("maps undefined to the default camp colour", () => {
    expect(normaliseCampColor(undefined)).toBe(DEFAULT_CAMP_COLOR);
  });

  it("maps an empty string to the default camp colour", () => {
    expect(normaliseCampColor("")).toBe(DEFAULT_CAMP_COLOR);
  });

  it("maps a whitespace-only string to the default camp colour", () => {
    expect(normaliseCampColor("   ")).toBe(DEFAULT_CAMP_COLOR);
  });

  it("maps an invalid value to the default camp colour", () => {
    expect(normaliseCampColor("not-a-color")).toBe(DEFAULT_CAMP_COLOR);
  });

  it("passes a valid lowercase hex through unchanged", () => {
    expect(normaliseCampColor("#2563eb")).toBe("#2563eb");
  });

  it("passes a valid uppercase hex through unchanged", () => {
    expect(normaliseCampColor("#2563EB")).toBe("#2563EB");
  });
});
