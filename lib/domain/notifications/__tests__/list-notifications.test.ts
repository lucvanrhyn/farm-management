/**
 * @vitest-environment node
 *
 * Wave F (#163) — domain op: `listNotifications`.
 *
 * Thin wrapper over `getCachedNotifications(slug, userEmail)` from
 * `lib/server/cached.ts`. The op exists so the route layer can call into a
 * typed domain surface (matches every other Wave A→F adapter) rather than
 * importing the cache helper directly. Wire shape — `{ notifications,
 * unreadCount }` — is preserved verbatim from `CachedNotificationsPayload`
 * so the NotificationBell + admin UI keep working with no client changes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetCached = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/cached", () => ({
  getCachedNotifications: mockGetCached,
}));

import { listNotifications } from "../list-notifications";

describe("listNotifications(slug, userEmail)", () => {
  beforeEach(() => {
    mockGetCached.mockReset();
  });

  it("delegates to getCachedNotifications with (slug, userEmail)", async () => {
    mockGetCached.mockResolvedValue({ notifications: [], unreadCount: 0 });

    await listNotifications("trio-b", "alice@example.com");

    expect(mockGetCached).toHaveBeenCalledWith("trio-b", "alice@example.com");
  });

  it("returns the cached payload verbatim", async () => {
    const payload = {
      notifications: [
        {
          id: "n-1",
          type: "alert",
          severity: "warning",
          message: "Low water",
          href: "/dashboard",
          isRead: false,
          createdAt: "2026-05-08T10:00:00Z",
          expiresAt: "2026-05-09T10:00:00Z",
        },
      ],
      unreadCount: 1,
    };
    mockGetCached.mockResolvedValue(payload);

    const result = await listNotifications("trio-b", "alice@example.com");

    expect(result).toEqual(payload);
  });

  it("supports empty userEmail (legacy fallback)", async () => {
    mockGetCached.mockResolvedValue({ notifications: [], unreadCount: 0 });

    await listNotifications("trio-b", "");

    expect(mockGetCached).toHaveBeenCalledWith("trio-b", "");
  });
});
