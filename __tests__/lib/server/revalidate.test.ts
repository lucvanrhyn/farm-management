/**
 * __tests__/lib/server/revalidate.test.ts
 *
 * Issue #413 — `revalidateObservationWrite(slug, observationType)` must thread
 * the observation type through to `observationWriteTags` so the
 * `farm-<slug>-camps` tag is invalidated on camp-inspection writes.
 *
 * Mock pattern mirrors the existing `revalidateTag` mocks scattered through
 * `__tests__/api/**` (e.g. `__tests__/api/animals.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import { revalidateTag } from "next/cache";
import {
  revalidateObservationWrite,
  revalidateAnimalWrite,
  revalidateCampWrite,
} from "@/lib/server/revalidate";
import { farmTag } from "@/lib/server/cache-tags";

const SLUG = "trio-b";

beforeEach(() => {
  vi.mocked(revalidateTag).mockClear();
});

describe("revalidateObservationWrite (issue #413)", () => {
  it("for a non-camp-inspection type (weighing), revalidates observations + dashboard only", () => {
    revalidateObservationWrite(SLUG, "weighing");

    const calls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag(SLUG, "observations"));
    expect(calls).toContain(farmTag(SLUG, "dashboard"));
    expect(calls).not.toContain(farmTag(SLUG, "camps"));
    expect(calls).toHaveLength(2);
  });

  it("for null observation type (admin reset, NVD/IT3 reuse), revalidates observations + dashboard only", () => {
    revalidateObservationWrite(SLUG, null);

    const calls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag(SLUG, "observations"));
    expect(calls).toContain(farmTag(SLUG, "dashboard"));
    expect(calls).not.toContain(farmTag(SLUG, "camps"));
    expect(calls).toHaveLength(2);
  });

  it("for camp_condition, ALSO revalidates the camps tag (the bug fix)", () => {
    revalidateObservationWrite(SLUG, "camp_condition");

    const calls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag(SLUG, "observations"));
    expect(calls).toContain(farmTag(SLUG, "dashboard"));
    expect(calls).toContain(farmTag(SLUG, "camps"));
    expect(calls).toHaveLength(3);
  });

  it("for camp_check, ALSO revalidates the camps tag (the bug fix)", () => {
    revalidateObservationWrite(SLUG, "camp_check");

    const calls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag(SLUG, "observations"));
    expect(calls).toContain(farmTag(SLUG, "dashboard"));
    expect(calls).toContain(farmTag(SLUG, "camps"));
    expect(calls).toHaveLength(3);
  });

  it("calls revalidateTag with the 'max' profile (verbatim cache-purge contract)", () => {
    revalidateObservationWrite(SLUG, "camp_condition");
    for (const call of vi.mocked(revalidateTag).mock.calls) {
      expect(call[1]).toBe("max");
    }
  });

  it("is per-slug — no cross-farm contamination on camp-inspection writes", () => {
    revalidateObservationWrite("trio-b", "camp_condition");
    const calls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag("trio-b", "camps"));
    expect(calls).not.toContain(farmTag("basson", "camps"));
  });
});

describe("revalidate.ts — other helpers still work (no regression)", () => {
  it("revalidateAnimalWrite invalidates animals + dashboard", () => {
    revalidateAnimalWrite(SLUG);
    const calls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag(SLUG, "animals"));
    expect(calls).toContain(farmTag(SLUG, "dashboard"));
  });

  it("revalidateCampWrite invalidates camps + dashboard", () => {
    revalidateCampWrite(SLUG);
    const calls = vi.mocked(revalidateTag).mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag(SLUG, "camps"));
    expect(calls).toContain(farmTag(SLUG, "dashboard"));
  });
});
