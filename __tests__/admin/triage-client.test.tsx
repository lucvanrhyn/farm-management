/* @vitest-environment jsdom */
/**
 * __tests__/admin/triage-client.test.tsx — Herd Triage v1 UI (decision 10).
 *
 * TriageClient is a pure client component over the AttentionItem[] read model
 * (lib/server/triage/types.ts). It owns the ranked list, the Segmented
 * severity/reason filters, the herd-at-a-glance KpiCards and the "unlock more"
 * strip. No server imports — props are the projected items + the present
 * reason set, so the test renders it directly with fixtures.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import TriageClient from "@/components/admin/TriageClient";
import type { AttentionItem } from "@/lib/server/triage/types";
import { reasonMeta } from "@/lib/server/triage/reasons";

afterEach(() => cleanup());

const FARM = "trio-b";

function item(
  animalId: string,
  reasonIds: Parameters<typeof reasonMeta>[0][],
): AttentionItem {
  const reasons = reasonIds.map((id) => reasonMeta(id));
  const urgency = reasons.reduce((s, r) => s + r.weight, 0);
  const severity = reasons.some((r) => r.severity === "red") ? "red" : "amber";
  return {
    animalId,
    reasons,
    urgency,
    severity,
    species: "cattle",
  };
}

// Ranked highest-urgency first (the orchestrator returns them pre-sorted).
const ITEMS: AttentionItem[] = [
  item("COW-12", ["in-withdrawal", "no-camp"]), // red
  item("COW-07", ["poor-doer", "missing-dob"]), // amber
  item("EWE-03", ["dosing-overdue"]), // amber, sheep-origin reason
];
// EWE-03 is a sheep reason but species tag still cattle in fixture builder;
// override for realism:
ITEMS[2].species = "sheep";

describe("TriageClient — ranked list (slice 1)", () => {
  it("renders one row per attention item in the given order, keyed on animalId", () => {
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    expect(screen.getByText("COW-12")).toBeTruthy();
    expect(screen.getByText("COW-07")).toBeTruthy();
    expect(screen.getByText("EWE-03")).toBeTruthy();
  });

  it("shows the deterministic one-liner narration for each item", () => {
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    // narrateTriageItem(COW-12) -> "Act now: COW-12 has ..."
    expect(screen.getByText(/Act now: COW-12/)).toBeTruthy();
    expect(screen.getByText(/Attend soon: COW-07/)).toBeTruthy();
  });

  it("renders a reason badge per reason on each row", () => {
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    // Scope to the COW-12 row so we assert the *badge*, not the reason-select
    // <option> which shares the same label text.
    const row = screen.getByText("COW-12").closest("a") as HTMLElement;
    expect(within(row).getByText("In withdrawal")).toBeTruthy();
    expect(within(row).getByText("No camp")).toBeTruthy();
    const row2 = screen.getByText("COW-07").closest("a") as HTMLElement;
    expect(within(row2).getByText("Poor doer")).toBeTruthy();
  });

  it("links each row through to the animal keyed on animalId (business key)", () => {
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    const link = screen.getByText("COW-12").closest("a");
    expect(link?.getAttribute("href")).toBe(`/${FARM}/admin/animals/COW-12`);
  });
});

describe("TriageClient — herd-at-a-glance KpiCards (slice 4)", () => {
  it("shows total-needing-attention and urgent counts", () => {
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    // 3 animals need attention, 1 is urgent (red).
    const total = screen.getByTestId("triage-kpi-total");
    expect(within(total).getByText("3")).toBeTruthy();
    const urgent = screen.getByTestId("triage-kpi-urgent");
    expect(within(urgent).getByText("1")).toBeTruthy();
  });
});

describe("TriageClient — severity filter (slice 2)", () => {
  it("filters to red-only items when Critical is selected", () => {
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    fireEvent.click(screen.getByRole("tab", { name: /Critical/ }));
    expect(screen.getByText("COW-12")).toBeTruthy();
    expect(screen.queryByText("COW-07")).toBeNull();
    expect(screen.queryByText("EWE-03")).toBeNull();
  });

  it("filters to amber-only items when Caution is selected", () => {
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    fireEvent.click(screen.getByRole("tab", { name: /Caution/ }));
    expect(screen.queryByText("COW-12")).toBeNull();
    expect(screen.getByText("COW-07")).toBeTruthy();
    expect(screen.getByText("EWE-03")).toBeTruthy();
  });
});

describe("TriageClient — reason filter (slice 3)", () => {
  it("narrows to items carrying the selected reason", () => {
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    // Reason filter is a <select> so it scales past the segmented severity row.
    const reasonSelect = screen.getByLabelText(/reason/i) as HTMLSelectElement;
    fireEvent.change(reasonSelect, { target: { value: "poor-doer" } });
    expect(screen.getByText("COW-07")).toBeTruthy();
    expect(screen.queryByText("COW-12")).toBeNull();
    expect(screen.queryByText("EWE-03")).toBeNull();
  });
});

describe("TriageClient — unlock-more strip (slice 5)", () => {
  it("shows a greyed chip for history reasons absent from the data", () => {
    // Only snapshot reasons present -> all history reasons are 'unlock more'.
    const snapshotOnly: AttentionItem[] = [item("COW-99", ["no-camp"])];
    render(<TriageClient items={snapshotOnly} farmSlug={FARM} />);
    const strip = screen.getByTestId("triage-unlock-strip");
    expect(within(strip).getByText("Poor doer")).toBeTruthy();
    expect(within(strip).getByText("Dosing overdue")).toBeTruthy();
    expect(within(strip).getByText("In withdrawal")).toBeTruthy();
  });

  it("hides the unlock strip entirely when every history reason is present", () => {
    // ITEMS carries poor-doer + dosing-overdue + in-withdrawal — nothing left
    // to unlock, so the whole strip is absent.
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    expect(screen.queryByTestId("triage-unlock-strip")).toBeNull();
  });

  it("lists only the still-locked history reasons when some are present", () => {
    // Present: in-withdrawal (history) + no-camp (snapshot). Locked: poor-doer,
    // dosing-overdue.
    const partial: AttentionItem[] = [item("COW-50", ["in-withdrawal", "no-camp"])];
    render(<TriageClient items={partial} farmSlug={FARM} />);
    const strip = screen.getByTestId("triage-unlock-strip");
    expect(within(strip).getByText("Poor doer")).toBeTruthy();
    expect(within(strip).getByText("Dosing overdue")).toBeTruthy();
    expect(within(strip).queryByText("In withdrawal")).toBeNull();
  });
});

describe("TriageClient — all-clear empty state (slice 7)", () => {
  it("renders an all-clear panel when there are no items", () => {
    render(<TriageClient items={[]} farmSlug={FARM} />);
    expect(screen.getByText(/All clear/i)).toBeTruthy();
  });
});

describe("TriageClient — cross-link to alerts (slice 6)", () => {
  it("links to the aggregate alerts centre", () => {
    render(<TriageClient items={ITEMS} farmSlug={FARM} />);
    const link = screen.getByText(/alert centre|alerts/i).closest("a");
    expect(link?.getAttribute("href")).toBe(`/${FARM}/admin/alerts`);
  });
});
