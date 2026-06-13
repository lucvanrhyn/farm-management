/**
 * @vitest-environment node
 *
 * __tests__/lib/scope-href.test.ts — the single farm-scoping guard for
 * notification deep-links (lib/notifications/scope-href.ts).
 */

import { describe, it, expect } from "vitest";
import { scopeHref } from "@/lib/notifications/scope-href";

const FARM = "basson-boerdery";

describe("scopeHref", () => {
  it("prefixes a bare /admin path (legacy persisted row self-heal)", () => {
    expect(scopeHref("/admin/camps/C-1", FARM)).toBe(
      `/${FARM}/admin/camps/C-1`,
    );
  });

  it("prefixes a bare /tools path", () => {
    expect(scopeHref("/tools/drought", FARM)).toBe(`/${FARM}/tools/drought`);
  });

  it("is idempotent — an already-scoped href is unchanged", () => {
    expect(scopeHref(`/${FARM}/admin/camps/C-1`, FARM)).toBe(
      `/${FARM}/admin/camps/C-1`,
    );
  });

  it("does not double-prefix on repeated application", () => {
    const once = scopeHref("/admin/animals", FARM);
    expect(scopeHref(once, FARM)).toBe(once);
  });

  it("preserves the query string (the ?focus= deep-link)", () => {
    expect(scopeHref("/admin/animals?focus=COW-7", FARM)).toBe(
      `/${FARM}/admin/animals?focus=COW-7`,
    );
  });

  it("preserves an already-scoped href's query string", () => {
    expect(scopeHref(`/${FARM}/admin/animals?focus=COW-7`, FARM)).toBe(
      `/${FARM}/admin/animals?focus=COW-7`,
    );
  });

  it("preserves the hash fragment", () => {
    expect(scopeHref("/admin/tax/it3#section-2", FARM)).toBe(
      `/${FARM}/admin/tax/it3#section-2`,
    );
  });

  it("adds a leading slash to a relative path", () => {
    expect(scopeHref("admin/animals", FARM)).toBe(`/${FARM}/admin/animals`);
  });

  it("does not strip a slug that is only a prefix of a different segment", () => {
    // `/basson-boerdery-archive` must NOT be treated as the `/basson-boerdery`
    // segment — it is a different first segment.
    expect(scopeHref("/basson-boerdery-archive/x", FARM)).toBe(
      `/${FARM}/basson-boerdery-archive/x`,
    );
  });

  it("handles the slug-only path (root of the farm)", () => {
    expect(scopeHref(`/${FARM}`, FARM)).toBe(`/${FARM}/`);
  });

  it("returns absolute http(s) URLs unchanged", () => {
    expect(scopeHref("https://example.com/x", FARM)).toBe(
      "https://example.com/x",
    );
  });

  it("returns the href unchanged when farmSlug is empty", () => {
    expect(scopeHref("/admin/animals", "")).toBe("/admin/animals");
  });
});
