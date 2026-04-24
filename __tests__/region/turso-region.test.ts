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

  it("detects Frankfurt (eu-central-1) — the Phase E target region", () => {
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
      "libsql://Trio-B-Boerdery.AWS-EU-CENTRAL-1.turso.io";
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
  it("contains the three regions FarmTrack has historically used or plans to use", () => {
    const codes = TURSO_REGIONS.map((r) => r.code) as TursoRegion[];
    expect(codes).toContain("fra");
    expect(codes).toContain("nrt");
    expect(codes).toContain("iad");
  });

  it("pairs each code with its AWS region suffix for deterministic parsing", () => {
    const fra = TURSO_REGIONS.find((r) => r.code === "fra");
    expect(fra?.awsRegion).toBe("eu-central-1");
  });
});
