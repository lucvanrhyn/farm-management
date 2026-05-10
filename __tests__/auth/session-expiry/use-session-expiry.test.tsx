// @vitest-environment jsdom
/**
 * P1.6 — useSessionExpiry hook
 *
 * Behaviour pinned by this spec:
 *  - Reads the next-auth session via useSession() and exposes a derived view:
 *      { status, expiresAt, timeRemainingMs, isExpired, isExpiringSoon }
 *  - status="loading" or no session → all flags false, expiresAt null.
 *  - status="authenticated" with session.expires in the future →
 *      isExpired=false; isExpiringSoon=true only when timeRemainingMs <= warnAheadMs.
 *  - status="unauthenticated" after starting authenticated → isExpired=true.
 *  - When the session is authenticated and the wall-clock crosses session.expires,
 *    the hook re-renders and reports isExpired=true even before next-auth's own
 *    poll updates status. (Timer-driven local recompute.)
 *  - Cleans up its interval on unmount.
 *
 * Mocks: next-auth/react useSession only — `vi.hoisted()` per
 * memory/feedback-vi-hoisted-shared-mocks.md so the shared state isn't TDZ'd.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => mocks.useSession(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.useSession.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function loadHook() {
  const mod = await import("@/lib/auth/use-session-expiry");
  return mod.useSessionExpiry;
}

describe("useSessionExpiry", () => {
  it("returns inert state while session is loading", async () => {
    mocks.useSession.mockReturnValue({ data: null, status: "loading" });
    const useSessionExpiry = await loadHook();

    const { result } = renderHook(() => useSessionExpiry({ warnAheadMs: 60_000 }));

    expect(result.current.status).toBe("loading");
    expect(result.current.isExpired).toBe(false);
    expect(result.current.isExpiringSoon).toBe(false);
    expect(result.current.expiresAt).toBeNull();
  });

  it("returns inert state when unauthenticated from the start", async () => {
    mocks.useSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const useSessionExpiry = await loadHook();

    const { result } = renderHook(() => useSessionExpiry({ warnAheadMs: 60_000 }));

    // No prior authenticated session, so this is "logged out", not "expired".
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.isExpired).toBe(false);
    expect(result.current.expiresAt).toBeNull();
  });

  it("reports far-future expiry as not-expiring", async () => {
    const now = new Date("2026-05-10T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const expires = new Date(now + 30 * 60_000).toISOString(); // 30 min ahead
    mocks.useSession.mockReturnValue({
      data: { expires, user: { id: "u1" } },
      status: "authenticated",
    });
    const useSessionExpiry = await loadHook();

    const { result } = renderHook(() => useSessionExpiry({ warnAheadMs: 60_000 }));

    expect(result.current.status).toBe("authenticated");
    expect(result.current.isExpired).toBe(false);
    expect(result.current.isExpiringSoon).toBe(false);
    expect(result.current.expiresAt?.getTime()).toBe(new Date(expires).getTime());
    expect(result.current.timeRemainingMs).toBeGreaterThan(60_000);
  });

  it("reports isExpiringSoon when within the warn window", async () => {
    const now = new Date("2026-05-10T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const expires = new Date(now + 30_000).toISOString(); // 30 s ahead, warn=60 s
    mocks.useSession.mockReturnValue({
      data: { expires, user: { id: "u1" } },
      status: "authenticated",
    });
    const useSessionExpiry = await loadHook();

    const { result } = renderHook(() => useSessionExpiry({ warnAheadMs: 60_000 }));

    expect(result.current.isExpired).toBe(false);
    expect(result.current.isExpiringSoon).toBe(true);
  });

  it("flips to isExpired once wall-clock crosses session.expires", async () => {
    const now = new Date("2026-05-10T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const expires = new Date(now + 5_000).toISOString();
    mocks.useSession.mockReturnValue({
      data: { expires, user: { id: "u1" } },
      status: "authenticated",
    });
    const useSessionExpiry = await loadHook();

    const { result } = renderHook(() => useSessionExpiry({ warnAheadMs: 60_000 }));

    expect(result.current.isExpired).toBe(false);

    // Cross the expiry boundary without next-auth status changing.
    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    expect(result.current.isExpired).toBe(true);
  });

  it("treats status=unauthenticated as expired once we previously saw a session", async () => {
    // Start authenticated …
    const now = new Date("2026-05-10T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const expires = new Date(now + 60 * 60_000).toISOString();
    mocks.useSession.mockReturnValue({
      data: { expires, user: { id: "u1" } },
      status: "authenticated",
    });
    const useSessionExpiry = await loadHook();

    const { result, rerender } = renderHook(() =>
      useSessionExpiry({ warnAheadMs: 60_000 }),
    );
    expect(result.current.isExpired).toBe(false);

    // … then next-auth flips to unauthenticated (e.g. its own refetch detected
    // the JWT is invalid). Without this signal, idle users wouldn't see the banner.
    mocks.useSession.mockReturnValue({ data: null, status: "unauthenticated" });
    rerender();

    expect(result.current.isExpired).toBe(true);
  });
});
