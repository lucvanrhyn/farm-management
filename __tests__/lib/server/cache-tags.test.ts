/**
 * __tests__/lib/server/cache-tags.test.ts
 *
 * Verifies the tag taxonomy used by unstable_cache helpers.
 * These strings are the contract between cached data and mutation routes —
 * a typo here silently causes stale reads after writes.
 */

import { describe, it, expect } from "vitest";
import {
  farmTag,
  animalWriteTags,
  observationWriteTags,
  campWriteTags,
  mobWriteTags,
  taskWriteTags,
  settingsWriteTags,
  transactionWriteTags,
  alertWriteTags,
  rotationWriteTags,
} from "@/lib/server/cache-tags";

describe("farmTag", () => {
  it("defaults to broad farm tag when scope is 'all' or omitted", () => {
    expect(farmTag("trio-b")).toBe("farm-trio-b");
    expect(farmTag("trio-b", "all")).toBe("farm-trio-b");
  });

  it("produces farm-<slug>-<scope> for every scope", () => {
    const slug = "test-farm";
    expect(farmTag(slug, "dashboard")).toBe("farm-test-farm-dashboard");
    expect(farmTag(slug, "camps")).toBe("farm-test-farm-camps");
    expect(farmTag(slug, "animals")).toBe("farm-test-farm-animals");
    expect(farmTag(slug, "observations")).toBe("farm-test-farm-observations");
    expect(farmTag(slug, "settings")).toBe("farm-test-farm-settings");
    expect(farmTag(slug, "tasks")).toBe("farm-test-farm-tasks");
    expect(farmTag(slug, "alerts")).toBe("farm-test-farm-alerts");
  });

  it("isolates tags per slug — different slugs produce different tags", () => {
    expect(farmTag("trio-b", "camps")).not.toBe(farmTag("basson", "camps"));
  });

  it("produces consistent strings (no trailing dashes or spaces)", () => {
    const tag = farmTag("my-farm", "dashboard");
    expect(tag.startsWith("farm-")).toBe(true);
    expect(tag.endsWith("-")).toBe(false);
    expect(tag.trim()).toBe(tag);
  });
});

describe("mutation tag arrays", () => {
  const SLUG = "trio-b";

  it("animalWriteTags includes animals + dashboard scopes", () => {
    const tags = animalWriteTags(SLUG);
    expect(tags).toContain(farmTag(SLUG, "animals"));
    expect(tags).toContain(farmTag(SLUG, "dashboard"));
    expect(tags).toHaveLength(2);
  });

  it("observationWriteTags includes observations + dashboard scopes", () => {
    const tags = observationWriteTags(SLUG);
    expect(tags).toContain(farmTag(SLUG, "observations"));
    expect(tags).toContain(farmTag(SLUG, "dashboard"));
    expect(tags).toHaveLength(2);
  });

  it("campWriteTags includes camps + dashboard scopes", () => {
    const tags = campWriteTags(SLUG);
    expect(tags).toContain(farmTag(SLUG, "camps"));
    expect(tags).toContain(farmTag(SLUG, "dashboard"));
    expect(tags).toHaveLength(2);
  });

  it("mobWriteTags includes animals + camps scopes (mobs affect both)", () => {
    const tags = mobWriteTags(SLUG);
    expect(tags).toContain(farmTag(SLUG, "animals"));
    expect(tags).toContain(farmTag(SLUG, "camps"));
    expect(tags).toHaveLength(2);
  });

  it("taskWriteTags includes tasks scope", () => {
    const tags = taskWriteTags(SLUG);
    expect(tags).toContain(farmTag(SLUG, "tasks"));
  });

  it("settingsWriteTags includes settings scope", () => {
    const tags = settingsWriteTags(SLUG);
    expect(tags).toContain(farmTag(SLUG, "settings"));
  });

  it("transactionWriteTags includes settings + dashboard (costs affect both)", () => {
    const tags = transactionWriteTags(SLUG);
    expect(tags).toContain(farmTag(SLUG, "settings"));
    expect(tags).toContain(farmTag(SLUG, "dashboard"));
    expect(tags).toHaveLength(2);
  });

  it("alertWriteTags includes alerts + dashboard scopes", () => {
    const tags = alertWriteTags(SLUG);
    expect(tags).toContain(farmTag(SLUG, "alerts"));
    expect(tags).toContain(farmTag(SLUG, "dashboard"));
    expect(tags).toHaveLength(2);
  });

  it("rotationWriteTags includes camps + dashboard scopes", () => {
    const tags = rotationWriteTags(SLUG);
    expect(tags).toContain(farmTag(SLUG, "camps"));
    expect(tags).toContain(farmTag(SLUG, "dashboard"));
    expect(tags).toHaveLength(2);
  });

  it("all tag arrays are per-slug — no cross-farm contamination", () => {
    const a = animalWriteTags("trio-b");
    const b = animalWriteTags("basson");
    for (const tagA of a) {
      expect(b).not.toContain(tagA);
    }
  });
});
