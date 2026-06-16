/* @vitest-environment jsdom */
/**
 * __tests__/admin/this-week-briefing.test.tsx — Weekly Farm Briefing v1,
 * decision 8: the in-app "This week" dashboard card.
 *
 * ThisWeekBriefing is a PURE presentational component over the deterministic
 * BriefingPayload (lib/server/briefing/payload.ts). It renders the three
 * farmer-facing sections — what changed / what to watch / what to do — and
 * OMITS any section whose array is empty (graceful degradation is load-bearing:
 * the card shows exactly what the payload carries and nothing more). When every
 * section is empty (payload.isEmpty) it shows a steady "all clear" state. The
 * dashboard never narrates on the hot path — this card uses ONLY the payload, no
 * LLM. Token-driven: components/ds + --ft-* tokens only.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ThisWeekBriefing from "@/components/admin/ThisWeekBriefing";
import type { BriefingPayload } from "@/lib/server/briefing/payload";

afterEach(() => cleanup());

const FARM = "trio-b";

function payload(over: Partial<BriefingPayload> = {}): BriefingPayload {
  const whatChanged = over.whatChanged ?? [];
  const whatToWatch = over.whatToWatch ?? [];
  const whatToDo = over.whatToDo ?? [];
  return {
    farmName: over.farmName ?? "Trio B Boerdery",
    whatChanged,
    whatToWatch,
    whatToDo,
    isEmpty:
      over.isEmpty ??
      (whatChanged.length === 0 &&
        whatToWatch.length === 0 &&
        whatToDo.length === 0),
  };
}

describe("ThisWeekBriefing — render (decision 8)", () => {
  it("renders all three section bodies when the payload has lines in each", () => {
    render(
      <ThisWeekBriefing
        payload={payload({
          whatChanged: ["3 weighings logged this week."],
          whatToWatch: ["COW-12 is a poor doer — review ADG."],
          whatToDo: ["Weigh COW-12 (due 2026-06-20)."],
        })}
        farmSlug={FARM}
      />,
    );

    // Section bodies — the deterministic payload lines render verbatim.
    expect(screen.getByText("3 weighings logged this week.")).toBeTruthy();
    expect(screen.getByText("COW-12 is a poor doer — review ADG.")).toBeTruthy();
    expect(screen.getByText("Weigh COW-12 (due 2026-06-20).")).toBeTruthy();

    // Section headers — what changed / watch / do.
    expect(screen.getByText(/what changed/i)).toBeTruthy();
    expect(screen.getByText(/what to watch/i)).toBeTruthy();
    expect(screen.getByText(/what to do/i)).toBeTruthy();
  });

  it("omits a section whose payload array is empty (graceful degradation)", () => {
    // Only "what changed" has data → "what to watch" / "what to do" must NOT
    // render their headers (the card shows exactly what the payload carries).
    render(
      <ThisWeekBriefing
        payload={payload({ whatChanged: ["1 death recorded this week."] })}
        farmSlug={FARM}
      />,
    );

    expect(screen.getByText("1 death recorded this week.")).toBeTruthy();
    expect(screen.getByText(/what changed/i)).toBeTruthy();
    expect(screen.queryByText(/what to watch/i)).toBeNull();
    expect(screen.queryByText(/what to do/i)).toBeNull();
  });

  it("renders the all-clear state when every section is empty", () => {
    render(<ThisWeekBriefing payload={payload()} farmSlug={FARM} />);

    // No section headers when there is nothing to report.
    expect(screen.queryByText(/what changed/i)).toBeNull();
    expect(screen.queryByText(/what to watch/i)).toBeNull();
    expect(screen.queryByText(/what to do/i)).toBeNull();
    // A steady "quiet week" / "all clear" message instead.
    expect(screen.getByText(/quiet week|all clear|nothing/i)).toBeTruthy();
  });

  it("always renders the 'This week' card header (always visible)", () => {
    // The card is ALWAYS on — even an empty payload still shows the eyebrow.
    render(<ThisWeekBriefing payload={payload()} farmSlug={FARM} />);
    expect(screen.getByText(/this week/i)).toBeTruthy();
  });
});
