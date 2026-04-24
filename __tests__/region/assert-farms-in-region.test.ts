// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertAllFarmsInRegion } from "@/lib/turso-region";

describe("assertAllFarmsInRegion", () => {
  it("returns ok when every farm is in the target region", () => {
    const farms = [
      { slug: "alpha", tursoUrl: "libsql://alpha.aws-eu-central-1.turso.io" },
      { slug: "beta", tursoUrl: "libsql://beta.aws-eu-central-1.turso.io" },
    ];

    const result = assertAllFarmsInRegion(farms, "fra");

    expect(result.ok).toBe(true);
    expect(result.offending).toEqual([]);
  });

  it("lists every farm not in the target region when some are outside", () => {
    const farms = [
      { slug: "alpha", tursoUrl: "libsql://alpha.aws-eu-central-1.turso.io" },
      { slug: "legacy", tursoUrl: "libsql://legacy.aws-ap-northeast-1.turso.io" },
      { slug: "oldbeta", tursoUrl: "libsql://oldbeta.aws-us-east-1.turso.io" },
    ];

    const result = assertAllFarmsInRegion(farms, "fra");

    expect(result.ok).toBe(false);
    expect(result.offending).toHaveLength(2);
    expect(result.offending.map((f) => f.slug)).toEqual(["legacy", "oldbeta"]);
    expect(result.offending[0].actualRegion).toBe("nrt");
    expect(result.offending[1].actualRegion).toBe("iad");
  });

  it("treats unparseable URLs as offending (they might be staging or malformed)", () => {
    const farms = [
      { slug: "broken", tursoUrl: "libsql://no-region.turso.io" },
    ];

    const result = assertAllFarmsInRegion(farms, "fra");

    expect(result.ok).toBe(false);
    expect(result.offending[0].slug).toBe("broken");
    expect(result.offending[0].actualRegion).toBeNull();
  });

  it("returns ok on an empty farm list — the cutover has no in-flight tenants", () => {
    const result = assertAllFarmsInRegion([], "fra");
    expect(result.ok).toBe(true);
    expect(result.offending).toEqual([]);
  });
});
