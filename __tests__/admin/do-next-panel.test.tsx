/* @vitest-environment jsdom */
/**
 * __tests__/admin/do-next-panel.test.tsx — Proactive Nudges v1 (decision 10a).
 *
 * DoNextPanel is a pure client component over the ranked DoNextItem[] feed
 * (lib/server/nudges/feed.ts). Each nudge renders a Card with:
 *   - the deterministic "why now" narration (narrateNudge),
 *   - a primary one-tap action Button that navigates to the prefilled form
 *     (scopeHref(item.href, farmSlug)),
 *   - a dismiss control (marks the notification read),
 *   - an "add as task" (do-later) control — replaced by an "already scheduled"
 *     marker when task-dedup flags the item's action as already pending.
 *
 * The do-later POST + dismiss PATCH go through fetch; we stub global.fetch and
 * assert the request shape rather than the network.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import DoNextPanel from "@/components/admin/DoNextPanel";
import type { DoNextItem } from "@/lib/server/nudges/feed";

afterEach(() => cleanup());

const FARM = "trio-b";

function nudge(over: Partial<DoNextItem> = {}): DoNextItem {
  return {
    id: over.id ?? "n1",
    type: over.type ?? "NO_WEIGHING_90D",
    severity: over.severity ?? "amber",
    message: over.message ?? "COW-12 not weighed in 90+ days",
    href: over.href ?? `/${FARM}/admin/animals/COW-12`,
    action: over.action ?? {
      taskType: "weighing",
      target: { animalId: "cuid-cow-12" },
      prefill: { animalId: "COW-12" },
      label: "Weigh COW-12",
    },
    dueDate: over.dueDate ?? null,
    createdAt: over.createdAt ?? "2026-06-15T06:00:00.000Z",
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DoNextPanel — render (decision 10a)", () => {
  it("renders one card per nudge with the why-now narration", () => {
    render(<DoNextPanel items={[nudge()]} farmSlug={FARM} />);
    // narrateNudge(amber) -> "Do soon: <message>. Next step: <label>."
    expect(screen.getByText(/Do soon:/)).toBeTruthy();
    expect(screen.getByText(/COW-12 not weighed/)).toBeTruthy();
  });

  it("renders the primary one-tap action as a navigation link labelled from the action", () => {
    // accept = client navigation (decision 7) → the primary action is a link to
    // the prefilled form, not a server-write button.
    render(<DoNextPanel items={[nudge()]} farmSlug={FARM} />);
    expect(screen.getByRole("link", { name: "Weigh COW-12" })).toBeTruthy();
  });

  it("points the primary action at the farm-scoped href via scope-href", () => {
    // Bare (legacy) href is self-healed to the active farm by scopeHref.
    render(
      <DoNextPanel
        items={[nudge({ href: "/admin/animals/COW-12" })]}
        farmSlug={FARM}
      />,
    );
    const link = screen.getByRole("link", { name: "Weigh COW-12" });
    expect(link.getAttribute("href")).toBe(`/${FARM}/admin/animals/COW-12`);
  });

  it("renders nothing when there are no nudges (panel self-hides)", () => {
    const { container } = render(<DoNextPanel items={[]} farmSlug={FARM} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("DoNextPanel — dismiss (decision 7)", () => {
  it("PATCHes the notification read and removes the card", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<DoNextPanel items={[nudge({ id: "n9" })]} farmSlug={FARM} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications/n9",
      expect.objectContaining({ method: "PATCH" }),
    );
    // Optimistic removal — the dismissed nudge leaves the feed.
    expect(screen.queryByText(/COW-12 not weighed/)).toBeNull();
  });
});

describe("DoNextPanel — add as task / do-later (decision 7)", () => {
  it("POSTs /api/tasks with the do-later body when 'add as task' is clicked", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<DoNextPanel items={[nudge()]} farmSlug={FARM} />);
    fireEvent.click(screen.getByRole("button", { name: /add as task/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/tasks")!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.taskType).toBe("weighing");
    expect(body.status).toBe("pending");
    expect(body.recurrenceSource).toBe("nudge:NO_WEIGHING_90D");
  });

  it("shows 'add as task' for a water-point nudge (waterPointId target, no camp/animal)", () => {
    const water = nudge({
      id: "wp-n1",
      type: "WATER_SERVICE_OVERDUE_30D",
      message: "Borehole 3 last serviced 45 days ago",
      href: `/${FARM}/admin/game/infrastructure`,
      action: {
        taskType: "water_point_service",
        target: { waterPointId: "wp-1" },
        prefill: { waterPointId: "wp-1", name: "Borehole 3" },
        label: "Service Borehole 3",
      },
    });
    render(<DoNextPanel items={[water]} farmSlug={FARM} />);
    expect(screen.getByRole("button", { name: /add as task/i })).toBeTruthy();
  });

  it("POSTs a water-point do-later task carrying the waterPointId", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const water = nudge({
      id: "wp-n2",
      type: "WATER_SERVICE_OVERDUE_30D",
      message: "Borehole 3 last serviced 45 days ago",
      href: `/${FARM}/admin/game/infrastructure`,
      action: {
        taskType: "water_point_service",
        target: { waterPointId: "wp-1" },
        prefill: { waterPointId: "wp-1", name: "Borehole 3" },
        label: "Service Borehole 3",
      },
    });
    render(<DoNextPanel items={[water]} farmSlug={FARM} createdBy="me@farm.test" />);
    fireEvent.click(screen.getByRole("button", { name: /add as task/i }));

    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/tasks")!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.taskType).toBe("water_point_service");
    expect(body.waterPointId).toBe("wp-1");
    expect(body.recurrenceSource).toBe("nudge:WATER_SERVICE_OVERDUE_30D");
  });

  it("shows 'already scheduled' instead of the add-task button when flagged", () => {
    render(
      <DoNextPanel
        items={[nudge({ id: "sched-1" })]}
        farmSlug={FARM}
        scheduledIds={["sched-1"]}
      />,
    );
    expect(screen.getByText(/already scheduled/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add as task/i })).toBeNull();
  });
});

describe("DoNextPanel — upgrade-gated action (IT3 off-advanced)", () => {
  it("renders the upgrade label and omits the add-task button when upgradeGated", () => {
    const it3 = nudge({
      id: "it3-1",
      type: "TAX_DEADLINE_IT3",
      severity: "red",
      message: "IT3 farming tax deadline in 30 days",
      href: `/${FARM}/admin/tax/it3`,
      dueDate: "2027-02-28",
      action: {
        taskType: "it3",
        target: {},
        prefill: { taxYear: 2027 },
        label: "Upgrade to file IT3",
        upgradeGated: true,
      },
    });
    render(<DoNextPanel items={[it3]} farmSlug={FARM} />);
    expect(screen.getByRole("link", { name: "Upgrade to file IT3" })).toBeTruthy();
    // No "add as task" for an upgrade-gated action — there is nothing to schedule.
    expect(screen.queryByRole("button", { name: /add as task/i })).toBeNull();
  });
});
