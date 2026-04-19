// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DataHealthCard from "@/components/admin/DataHealthCard";
import type { DataHealthScore } from "@/lib/server/data-health";

function makeScore(overrides: Partial<DataHealthScore> = {}): DataHealthScore {
  const base: DataHealthScore = {
    overall: 20,
    grade: "D",
    breakdown: {
      animalsWeighedRecently: {
        score: 0,
        pct: 0,
        label: "0 of 100 animals weighed in last 30 days",
      },
      campsInspectedRecently: {
        score: 0,
        pct: 0,
        label: "0 of 10 camps inspected in last 7 days",
      },
      animalsWithCampAssigned: {
        score: 20,
        pct: 95,
        label: "95 of 100 active animals have a camp",
      },
      transactionsThisMonth: {
        score: 0,
        present: false,
        label: "No transactions recorded this month",
      },
    },
    ...overrides,
  };
  return base;
}

describe("DataHealthCard — Quick Wins checklist", () => {
  beforeEach(() => cleanup());

  it("renders the 'Quick wins' headline when score is below celebration threshold", () => {
    render(<DataHealthCard score={makeScore({ overall: 20, grade: "D" })} />);
    expect(screen.getByText(/Quick wins to boost your data/i)).toBeTruthy();
  });

  it("renders a discreet score badge with grade", () => {
    render(<DataHealthCard score={makeScore({ overall: 20, grade: "D" })} />);
    expect(screen.getByText(/Score:\s*20\/100\s*·\s*D/)).toBeTruthy();
  });

  it("does NOT render the raw score as a giant letter grade (old UI)", () => {
    render(<DataHealthCard score={makeScore({ overall: 20, grade: "D" })} />);
    // No oversized grade element should remain
    expect(screen.queryByText(/^Overall score$/)).toBeNull();
  });

  it("shows 'Weigh a few animals' when weighed pct is low", () => {
    render(<DataHealthCard score={makeScore()} />);
    expect(screen.getByText(/Weigh a few animals/i)).toBeTruthy();
  });

  it("shows completed weigh-ins label when pct meets threshold", () => {
    const score = makeScore({
      breakdown: {
        ...makeScore().breakdown,
        animalsWeighedRecently: {
          score: 32,
          pct: 80,
          label: "80 of 100 animals weighed in last 30 days",
        },
      },
    });
    render(<DataHealthCard score={score} />);
    expect(screen.getByText(/Recent weigh-ins/i)).toBeTruthy();
  });

  it("parses unassigned count from the assigned label", () => {
    const score = makeScore({
      breakdown: {
        ...makeScore().breakdown,
        animalsWithCampAssigned: {
          score: 15,
          pct: 75,
          label: "75 of 80 active animals have a camp",
        },
      },
    });
    render(<DataHealthCard score={score} />);
    expect(screen.getByText(/Assign animals to camps \(5 unassigned\)/i)).toBeTruthy();
  });

  it("shows celebratory copy at score >= 80", () => {
    render(<DataHealthCard score={makeScore({ overall: 85, grade: "A" })} />);
    expect(screen.getByText(/Data health looking good/i)).toBeTruthy();
    // Quick-wins list should not render in the celebratory variant
    expect(screen.queryByText(/Weigh a few animals/i)).toBeNull();
  });

  it("marks the transactions item as done when present is true", () => {
    const score = makeScore({
      breakdown: {
        ...makeScore().breakdown,
        transactionsThisMonth: {
          score: 10,
          present: true,
          label: "Transactions recorded this month",
        },
      },
    });
    render(<DataHealthCard score={score} />);
    expect(screen.getByText(/Financial transactions logged this month/i)).toBeTruthy();
  });

  it("exposes an accessible aria-label for the score badge", () => {
    render(<DataHealthCard score={makeScore({ overall: 20, grade: "D" })} />);
    expect(
      screen.getByLabelText(/Data health score 20 out of 100, grade D/i),
    ).toBeTruthy();
  });
});
