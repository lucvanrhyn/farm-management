// @vitest-environment jsdom
/**
 * __tests__/components/notification-bell-polling.test.tsx
 *
 * Phase 4 — NotificationBell polling cadence.
 *
 * The bell used to repoll every 60 seconds per open tab; each poll was an
 * uncached 800-1100ms round-trip. Now that `/api/notifications` is cached
 * aggressively, we can relax the client polling to 120s without loss of
 * timeliness (the browser still surfaces new rows via tag invalidation on
 * writes + stale-while-revalidate between ticks).
 *
 * The test uses fake timers to prove the new cadence: no fetch at 119s,
 * a fresh fetch after 120s.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import NotificationBell from "@/components/admin/NotificationBell";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ notifications: [], unreadCount: 0 }),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("<NotificationBell /> polling cadence", () => {
  it("does not repoll within 119s of the initial fetch", async () => {
    await act(async () => {
      render(<NotificationBell farmSlug="trio-b" />);
    });
    // Let the initial fetch promise settle.
    await act(async () => {
      await Promise.resolve();
    });
    const initialCalls = mockFetch.mock.calls.length;

    // Advance just shy of the new cadence.
    await act(async () => {
      vi.advanceTimersByTime(119_000);
      await Promise.resolve();
    });

    expect(mockFetch.mock.calls.length).toBe(initialCalls);
  });

  it("repolls once the 120s interval elapses", async () => {
    await act(async () => {
      render(<NotificationBell farmSlug="trio-b" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const initialCalls = mockFetch.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });

    expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
