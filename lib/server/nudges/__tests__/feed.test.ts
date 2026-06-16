/**
 * @vitest-environment node
 *
 * lib/server/nudges/__tests__/feed.test.ts — the Do-Next feed.
 *
 * Reads action-carrying notifications and ranks them:
 *   1. severity (red before amber),
 *   2. category weight (compliance > veld > performance > ...),
 *   3. due-date proximity (sooner first).
 *
 * Notifications WITHOUT a payload.action are not nudges and are excluded.
 */

import { describe, it, expect } from "vitest";
import { rankDoNextFeed } from "@/lib/server/nudges/feed";
import type { CachedNotification } from "@/lib/server/cached";

const NOW = new Date("2026-06-16T08:00:00.000Z");

function notif(over: Partial<CachedNotification> & { action?: unknown; category?: string; dueDate?: string }): CachedNotification {
  const { action, category, dueDate, ...rest } = over;
  const payload =
    action !== undefined || category !== undefined || dueDate !== undefined
      ? JSON.stringify({ ...(action !== undefined ? { action } : {}), ...(category ? { category } : {}), ...(dueDate ? { dueDate } : {}) })
      : (rest.payload ?? null);
  return {
    id: "n",
    type: "NO_WEIGHING_90D",
    severity: "amber",
    message: "m",
    href: "/trio/admin/animals",
    isRead: false,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 48 * 3600 * 1000),
    ...rest,
    payload,
  };
}

const A = { taskType: "weighing", target: { animalId: "a" }, prefill: {}, label: "Weigh" };

describe("rankDoNextFeed", () => {
  it("excludes notifications without payload.action", () => {
    const rows = [
      notif({ id: "with", action: A }),
      notif({ id: "without" }), // no action
      notif({ id: "bad", payload: "not json" }),
    ];
    const feed = rankDoNextFeed(rows, NOW);
    expect(feed.map((f) => f.id)).toEqual(["with"]);
  });

  it("ranks red before amber", () => {
    const rows = [
      notif({ id: "amber", severity: "amber", action: A }),
      notif({ id: "red", severity: "red", action: A }),
    ];
    expect(rankDoNextFeed(rows, NOW).map((f) => f.id)).toEqual(["red", "amber"]);
  });

  it("within the same severity, higher category weight wins (compliance > performance)", () => {
    const rows = [
      notif({ id: "perf", severity: "amber", category: "performance", action: A }),
      notif({ id: "comp", severity: "amber", category: "compliance", action: A }),
    ];
    expect(rankDoNextFeed(rows, NOW).map((f) => f.id)).toEqual(["comp", "perf"]);
  });

  it("within same severity + category, sooner due-date wins", () => {
    const rows = [
      notif({ id: "later", severity: "amber", category: "compliance", dueDate: "2026-07-01", action: A }),
      notif({ id: "sooner", severity: "amber", category: "compliance", dueDate: "2026-06-20", action: A }),
    ];
    expect(rankDoNextFeed(rows, NOW).map((f) => f.id)).toEqual(["sooner", "later"]);
  });

  it("exposes the parsed action + severity on each feed item", () => {
    const feed = rankDoNextFeed([notif({ id: "x", severity: "red", action: A })], NOW);
    expect(feed[0]).toMatchObject({
      id: "x",
      severity: "red",
      action: A,
      message: "m",
      href: "/trio/admin/animals",
    });
  });

  it("excludes read notifications (already actioned/dismissed)", () => {
    const feed = rankDoNextFeed([notif({ id: "r", isRead: true, action: A })], NOW);
    expect(feed).toEqual([]);
  });
});
