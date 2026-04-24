// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guard against accidentally reverting the Phase E region change (or adding
// extra regions that would silently restore multi-region egress). `fra1` on
// its own pins every function to Frankfurt, which is the entire point of
// Phase E.
describe("vercel.json — Phase E region pin", () => {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
  );

  it("pins every Vercel function to fra1 (Frankfurt)", () => {
    expect(Array.isArray(config.regions)).toBe(true);
    expect(config.regions).toEqual(["fra1"]);
  });

  it("keeps the daily inngest cron wired at 05:00 UTC", () => {
    expect(config.crons).toContainEqual({
      path: "/api/inngest",
      schedule: "0 5 * * *",
    });
  });
});
