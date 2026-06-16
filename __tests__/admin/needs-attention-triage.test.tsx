/* @vitest-environment jsdom */
/**
 * __tests__/admin/needs-attention-triage.test.tsx — decision 10a.
 *
 * NeedsAttentionPanel is extended to surface a per-animal Triage top-5 (the
 * dashboard teaser for the full /admin/triage page) alongside its existing
 * aggregate-alert rows. The new `triage` prop is OPTIONAL and additive, so the
 * panel keeps rendering aggregate alerts unchanged when triage is omitted.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import NeedsAttentionPanel from "@/components/admin/NeedsAttentionPanel";
import type { DashboardAlerts } from "@/lib/server/dashboard-alerts";
import type { AttentionItem } from "@/lib/server/triage/types";
import { reasonMeta } from "@/lib/server/triage/reasons";

afterEach(() => cleanup());

const FARM = "trio-b";

const EMPTY_ALERTS: DashboardAlerts = { red: [], amber: [], totalCount: 0 };

function item(animalId: string, reasonIds: Parameters<typeof reasonMeta>[0][]): AttentionItem {
  const reasons = reasonIds.map((id) => reasonMeta(id));
  return {
    animalId,
    reasons,
    urgency: reasons.reduce((s, r) => s + r.weight, 0),
    severity: reasons.some((r) => r.severity === "red") ? "red" : "amber",
    species: "cattle",
  };
}

describe("NeedsAttentionPanel — triage teaser (decision 10a)", () => {
  it("renders a per-animal triage section with a herd-glance one-liner", () => {
    const triage = [
      item("COW-12", ["in-withdrawal"]),
      item("COW-07", ["poor-doer"]),
    ];
    render(
      <NeedsAttentionPanel alerts={EMPTY_ALERTS} farmSlug={FARM} triage={triage} />,
    );
    const section = screen.getByTestId("needs-attention-triage");
    // narrateHerdGlance: "2 animals need attention — 1 is urgent."
    expect(within(section).getByText(/2 animals need attention/)).toBeTruthy();
    expect(within(section).getByText("COW-12")).toBeTruthy();
  });

  it("caps the per-animal teaser at the top 5 animals", () => {
    const triage = Array.from({ length: 8 }, (_, i) =>
      item(`COW-${i}`, ["no-camp"]),
    );
    render(
      <NeedsAttentionPanel alerts={EMPTY_ALERTS} farmSlug={FARM} triage={triage} />,
    );
    const section = screen.getByTestId("needs-attention-triage");
    expect(within(section).getByText("COW-0")).toBeTruthy();
    expect(within(section).getByText("COW-4")).toBeTruthy();
    // The 6th+ animals are dropped from the teaser.
    expect(within(section).queryByText("COW-5")).toBeNull();
  });

  it("links each teaser row to the animal keyed on animalId", () => {
    const triage = [item("COW-12", ["in-withdrawal"])];
    render(
      <NeedsAttentionPanel alerts={EMPTY_ALERTS} farmSlug={FARM} triage={triage} />,
    );
    const link = screen.getByText("COW-12").closest("a");
    expect(link?.getAttribute("href")).toBe(`/${FARM}/admin/animals/COW-12`);
  });

  it("links to the full /admin/triage page", () => {
    const triage = [item("COW-12", ["in-withdrawal"])];
    render(
      <NeedsAttentionPanel alerts={EMPTY_ALERTS} farmSlug={FARM} triage={triage} />,
    );
    const section = screen.getByTestId("needs-attention-triage");
    const link = within(section).getByText(/view triage/i).closest("a");
    expect(link?.getAttribute("href")).toBe(`/${FARM}/admin/triage`);
  });

  it("omits the triage section entirely when no triage items are passed", () => {
    render(<NeedsAttentionPanel alerts={EMPTY_ALERTS} farmSlug={FARM} />);
    expect(screen.queryByTestId("needs-attention-triage")).toBeNull();
  });

  it("omits the triage section when the triage list is empty", () => {
    render(
      <NeedsAttentionPanel alerts={EMPTY_ALERTS} farmSlug={FARM} triage={[]} />,
    );
    expect(screen.queryByTestId("needs-attention-triage")).toBeNull();
  });

  it("still renders aggregate alert rows alongside the triage teaser", () => {
    const alerts: DashboardAlerts = {
      red: [
        {
          id: "a1",
          severity: "red",
          message: "1 animal in withdrawal",
          count: 1,
          href: `/${FARM}/admin/alerts`,
          species: "cattle",
          icon: "Pill",
        },
      ],
      amber: [],
      totalCount: 1,
    };
    const triage = [item("COW-12", ["in-withdrawal"])];
    render(
      <NeedsAttentionPanel alerts={alerts} farmSlug={FARM} triage={triage} />,
    );
    expect(screen.getByText("1 animal in withdrawal")).toBeTruthy();
    expect(screen.getByTestId("needs-attention-triage")).toBeTruthy();
  });
});
