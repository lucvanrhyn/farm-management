/**
 * __tests__/api/notifications-cache-control.test.ts
 *
 * Phase 4 — /api/notifications response header contract.
 *
 * The NotificationBell polls this endpoint every 120s per open tab.
 * Setting `Cache-Control: private, max-age=15, stale-while-revalidate=45`
 * lets the browser serve repeat requests within 15s directly from disk cache
 * without a network round-trip — which is the whole point of this phase.
 *
 * A failure of this test in review means the route regressed to uncached
 * behaviour and the bell would go back to hammering Turso through Vercel.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── next-auth session + auth-options stubs ──────────────────────────────────

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: {
      id: "user-1",
      email: "alice@example.com",
      farms: [{ slug: "trio-b", role: "ADMIN" }],
    },
  }),
}));

vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));

// ── getPrismaWithAuth: returns slug so the cached helper can key by it ──────

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaWithAuth: vi.fn().mockResolvedValue({
    prisma: {},
    slug: "trio-b",
    role: "ADMIN",
  }),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// ── Cached helper stub: returns the canonical payload shape ─────────────────

const mockGetCachedNotifications = vi.fn().mockResolvedValue({
  notifications: [],
  unreadCount: 0,
});

vi.mock("@/lib/server/cached", () => ({
  getCachedNotifications: (...args: unknown[]) =>
    mockGetCachedNotifications(...args),
}));

beforeEach(() => {
  mockGetCachedNotifications.mockClear();
});

describe("GET /api/notifications", () => {
  it("sends Cache-Control: private, max-age=15, stale-while-revalidate=45", async () => {
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET();

    const header = res.headers.get("cache-control");
    expect(header).toMatch(/private/);
    expect(header).toMatch(/max-age=15/);
    expect(header).toMatch(/stale-while-revalidate=45/);
  });

  it("delegates to getCachedNotifications with (slug, userEmail)", async () => {
    const { GET } = await import("@/app/api/notifications/route");
    await GET();

    expect(mockGetCachedNotifications).toHaveBeenCalledWith(
      "trio-b",
      "alice@example.com",
    );
  });

  it("emits a Server-Timing header", async () => {
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET();

    const header = res.headers.get("server-timing");
    expect(header).toBeTruthy();
    // The header format is `<metric>;dur=<ms>[, <metric>;dur=<ms>...]`.
    expect(header).toMatch(/dur=/);
  });

  it("returns 401 when no session is present", async () => {
    const nextAuth = await import("next-auth");
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
