/* @vitest-environment jsdom */
/**
 * __tests__/admin/notification-bell-action.test.tsx — Proactive Nudges v1
 * (decision 10b).
 *
 * NotificationBell is extended to parse each notification's `payload` JSON and,
 * when it carries a RecommendedAction (`payload.action`), render a one-tap
 * action Button under the message. The href is farm-scoped via scopeHref.
 *
 * The bell fetches /api/notifications on mount; we stub global.fetch to return a
 * fixed feed and assert the action button renders + points at the scoped href.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import NotificationBell from "@/components/admin/NotificationBell";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FARM = "trio-b";

function feedFetch(notifications: Array<{ isRead?: boolean; [k: string]: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/notifications") && !url.includes("read")) {
      return {
        ok: true,
        json: async () => ({
          notifications,
          unreadCount: notifications.filter((n) => !n.isRead).length,
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

const ACTION_NOTIF = {
  id: "n-act",
  type: "NO_WEIGHING_90D",
  severity: "amber" as const,
  message: "COW-12 not weighed in 90+ days",
  href: "/admin/animals/COW-12", // bare href → self-healed by scopeHref
  isRead: false,
  createdAt: "2026-06-15T06:00:00.000Z",
  payload: JSON.stringify({
    action: {
      taskType: "weighing",
      target: { animalId: "cuid-cow-12" },
      prefill: { animalId: "COW-12" },
      label: "Weigh COW-12",
    },
  }),
};

const PLAIN_NOTIF = {
  id: "n-plain",
  type: "PREDATOR_SPIKE",
  severity: "red" as const,
  message: "Predator activity logged",
  href: `/${FARM}/admin/alerts`,
  isRead: false,
  createdAt: "2026-06-15T06:00:00.000Z",
  payload: null,
};

describe("NotificationBell — inline action button (decision 10b)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", feedFetch([ACTION_NOTIF, PLAIN_NOTIF]));
  });

  it("renders a one-tap action link from payload.action when present", async () => {
    render(<NotificationBell farmSlug={FARM} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

    const action = await screen.findByRole("link", { name: "Weigh COW-12" });
    expect(action).toBeTruthy();
    // Bare href self-healed to the active farm by scopeHref.
    expect(action.getAttribute("href")).toBe(`/${FARM}/admin/animals/COW-12`);
  });

  it("renders no action button for a notification without an action payload", async () => {
    render(<NotificationBell farmSlug={FARM} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

    await screen.findByText("Predator activity logged");
    // The action notification still gets its action link…
    expect(screen.queryByRole("link", { name: "Weigh COW-12" })).toBeTruthy();
    // …but only ONE action link is rendered across the two-row feed (the plain
    // PREDATOR_SPIKE row, payload:null, carries no action button — only its
    // message-link). So exactly one action-style button link exists.
    const links = screen.getAllByRole("link");
    const actionLinks = links.filter((l) => l.className.includes("ft-btn-primary"));
    expect(actionLinks).toHaveLength(1);
    expect(actionLinks[0].textContent).toBe("Weigh COW-12");
  });
});

describe("NotificationBell — malformed payload is inert (defensive)", () => {
  it("does not crash and renders no action when payload is invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      feedFetch([{ ...ACTION_NOTIF, payload: "{not json" }]),
    );
    render(<NotificationBell farmSlug={FARM} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

    await waitFor(() =>
      expect(screen.getByText("COW-12 not weighed in 90+ days")).toBeTruthy(),
    );
    expect(screen.queryByRole("link", { name: "Weigh COW-12" })).toBeNull();
  });
});
