/**
 * lib/server/__tests__/revalidate-notifications.test.ts
 *
 * Phase 4 — /api/notifications cache contract.
 *
 * Two contracts are enforced here:
 *   1. `notificationTag(email)` returns a stable, user-scoped tag string that
 *      is distinct from the farm-scoped tag and does not collide across users.
 *   2. `revalidateNotificationWrite(slug, email?)` calls Next's `revalidateTag`
 *      with BOTH the farm-scoped `farm-<slug>-notifications` tag and — when an
 *      email is supplied — the per-user `notificationTag(email)` tag, so that a
 *      write in the notification generator (farm-wide) and a mark-read mutation
 *      (user-specific) each clear exactly the cache entries they affect.
 *
 * If either of those strings changes shape, `getCachedNotifications()` will
 * serve stale data to users — hence these contract tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRevalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

import { farmTag, notificationTag } from "@/lib/server/cache-tags";
import { revalidateNotificationWrite } from "@/lib/server/revalidate";

beforeEach(() => {
  mockRevalidateTag.mockClear();
});

describe("notificationTag()", () => {
  it("produces a stable, user-scoped tag distinct from farm-scoped tags", () => {
    const tag = notificationTag("alice@example.com");
    expect(tag).toContain("alice@example.com");
    expect(tag).not.toBe(farmTag("trio-b", "notifications"));
  });

  it("does not collide across different user emails", () => {
    expect(notificationTag("alice@example.com")).not.toBe(
      notificationTag("bob@example.com"),
    );
  });

  it("is case-sensitive email equal -> equal tag (idempotent)", () => {
    expect(notificationTag("alice@example.com")).toBe(
      notificationTag("alice@example.com"),
    );
  });
});

describe("farmTag with notifications scope", () => {
  it("returns farm-<slug>-notifications", () => {
    expect(farmTag("trio-b", "notifications")).toBe("farm-trio-b-notifications");
  });
});

describe("revalidateNotificationWrite()", () => {
  it("calls revalidateTag with the farm-scoped notifications tag", () => {
    revalidateNotificationWrite("trio-b");
    const calls = mockRevalidateTag.mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag("trio-b", "notifications"));
  });

  it("also fires the user-scoped tag when an email is supplied", () => {
    revalidateNotificationWrite("trio-b", "alice@example.com");
    const calls = mockRevalidateTag.mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag("trio-b", "notifications"));
    expect(calls).toContain(notificationTag("alice@example.com"));
  });

  it("omits the user tag when email is undefined", () => {
    revalidateNotificationWrite("trio-b");
    const calls = mockRevalidateTag.mock.calls.map((c) => c[0]);
    expect(calls).toContain(farmTag("trio-b", "notifications"));
    // Nothing that looks like a user tag should have fired.
    for (const tag of calls) {
      expect(tag).not.toContain("@");
    }
  });
});
