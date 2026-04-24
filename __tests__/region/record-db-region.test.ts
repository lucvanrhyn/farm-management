// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createTimingBag,
  emitServerTiming,
  runWithTimingBag,
} from "@/lib/server/server-timing";
import { recordFarmDbRegion } from "@/lib/server/region-timing";

describe("recordFarmDbRegion", () => {
  it("records `db-region-fra=1` into the active bag when the URL is in Frankfurt", () => {
    const bag = createTimingBag();
    runWithTimingBag(bag, () => {
      recordFarmDbRegion(
        "libsql://trio-b-boerdery.aws-eu-central-1.turso.io",
      );
    });

    const header = emitServerTiming(bag);
    expect(header).toContain("db-region-fra;dur=1");
  });

  it("records `db-region-nrt=1` so cutover observers can see a farm still in Tokyo", () => {
    const bag = createTimingBag();
    runWithTimingBag(bag, () => {
      recordFarmDbRegion(
        "libsql://trio-b.aws-ap-northeast-1.turso.io",
      );
    });

    const header = emitServerTiming(bag);
    expect(header).toContain("db-region-nrt;dur=1");
  });

  it("records `db-region-unknown=1` when the URL cannot be classified (alerts on malformed creds)", () => {
    const bag = createTimingBag();
    runWithTimingBag(bag, () => {
      recordFarmDbRegion("libsql://staging.example.com");
    });

    const header = emitServerTiming(bag);
    expect(header).toContain("db-region-unknown;dur=1");
  });

  it("is a no-op when no timing bag is active — never throws", () => {
    expect(() =>
      recordFarmDbRegion("libsql://trio-b.aws-eu-central-1.turso.io"),
    ).not.toThrow();
  });
});
