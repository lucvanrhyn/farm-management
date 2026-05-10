// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseTursoRegion,
  isTargetRegion,
  TURSO_REGIONS,
  type TursoRegion,
} from "@/lib/turso-region";

describe("parseTursoRegion", () => {
  it("detects Tokyo (ap-northeast-1) from a legacy Turso URL", () => {
    const url =
      "libsql://delta-livestock-lucvanrhyn.aws-ap-northeast-1.turso.io";
    expect(parseTursoRegion(url)).toBe("nrt");
  });

  it("detects Ireland (eu-west-1) — the current Phase E target region", () => {
    // 2026-04-24: Turso retired Frankfurt (aws-eu-central-1) before we ran
    // the cutover; Ireland is the closest remaining Turso region to our
    // Vercel fra1 functions (~30ms Vercel→DB vs 250ms Tokyo).
    const url =
      "libsql://delta-livestock-lucvanrhyn.aws-eu-west-1.turso.io";
    expect(parseTursoRegion(url)).toBe("dub");
  });

  it("still detects Frankfurt (eu-central-1) if a legacy URL appears — historical compat", () => {
    const url =
      "libsql://delta-livestock-lucvanrhyn.aws-eu-central-1.turso.io";
    expect(parseTursoRegion(url)).toBe("fra");
  });

  it("detects US East (us-east-1) for pre-2026 legacy farms", () => {
    const url = "libsql://legacy-farm.aws-us-east-1.turso.io";
    expect(parseTursoRegion(url)).toBe("iad");
  });

  it("returns null for a URL that doesn't match the Turso hostname pattern", () => {
    expect(parseTursoRegion("https://example.com")).toBeNull();
    expect(parseTursoRegion("not-a-url")).toBeNull();
    expect(parseTursoRegion("")).toBeNull();
  });

  it("returns null for a Turso URL without an AWS region segment", () => {
    expect(parseTursoRegion("libsql://foo.turso.io")).toBeNull();
  });

  it("is case-insensitive on the region suffix", () => {
    const url =
      "libsql://Delta-Livestock.AWS-EU-CENTRAL-1.turso.io";
    expect(parseTursoRegion(url)).toBe("fra");
  });
});

describe("isTargetRegion", () => {
  it("returns true when the URL is in the expected region", () => {
    const url =
      "libsql://trio-b.aws-eu-central-1.turso.io";
    expect(isTargetRegion(url, "fra")).toBe(true);
  });

  it("returns false when the URL is in a different region", () => {
    const url =
      "libsql://trio-b.aws-ap-northeast-1.turso.io";
    expect(isTargetRegion(url, "fra")).toBe(false);
  });

  it("returns false when the URL cannot be parsed", () => {
    expect(isTargetRegion("not-a-url", "fra")).toBe(false);
  });
});

describe("TURSO_REGIONS registry", () => {
  it("contains every region FarmTrack has historically used or plans to use", () => {
    const codes = TURSO_REGIONS.map((r) => r.code) as TursoRegion[];
    expect(codes).toContain("dub"); // Ireland — current Phase E target
    expect(codes).toContain("fra"); // Frankfurt — retired by Turso but kept for parsing
    expect(codes).toContain("nrt");
    expect(codes).toContain("iad");
  });

  it("pairs each code with its AWS region suffix for deterministic parsing", () => {
    const dub = TURSO_REGIONS.find((r) => r.code === "dub");
    expect(dub?.awsRegion).toBe("eu-west-1");
    const fra = TURSO_REGIONS.find((r) => r.code === "fra");
    expect(fra?.awsRegion).toBe("eu-central-1");
  });
});
