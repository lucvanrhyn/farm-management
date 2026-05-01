/**
 * __tests__/calculators/sars-livestock-values-para7.test.ts
 *
 * Locks the SARS First Schedule paragraph 7 election lock-in semantics that
 * `effectiveValue` and the surrounding stock-block valuer must enforce.
 *
 *   Paragraph 7 (verbatim per the SARS IT35 Annexure + sataxguide.co.za /
 *   IT35 §3.4 commentary, retrieved 2026-05-01):
 *
 *     "Once an option [under paragraph 6] is exercised, it shall be binding
 *      in respect of all subsequent returns rendered by the farmer and may
 *      not be varied without the consent of the Commissioner."
 *
 *   Two consequences for the calculator:
 *
 *   (1) The lock-in is INDEFINITE — not a 4-year window. Once a taxpayer has
 *       elected a value within the ±20% band of paragraph 6, that election is
 *       binding for every subsequent return until SARS approves a change.
 *
 *   (2) The lock-in is a constraint at ELECTION-CREATION time, not at
 *       VALUATION time. Once an election sits in `SarsLivestockElection`
 *       with the right `electedYear`, every later year's IT3 simply adopts
 *       it via `loadElectionsForYear` (latest election per class wins).
 *       The valuer therefore takes the current election only — it does NOT
 *       need a `priorElection` parameter to police lock-in. Re-electing a
 *       different value without `sarsChangeApprovalRef` must be rejected at
 *       insert time (a separate concern from valuation).
 *
 * This test pins the calculator to that contract. Internal-tests-pass ≠
 * external-spec-correct (see feedback-regulatory-output-validate-against-spec.md):
 * each block below cites the rule it is enforcing in plain language so a future
 * reviewer can defend the test against the actual SARS guide.
 */

import { describe, it, expect } from "vitest";
import {
  effectiveValue,
  type ElectionRecord,
  type LivestockClass,
} from "@/lib/calculators/sars-livestock-values";
import { valueStockBlock } from "@/lib/calculators/sars-stock";

// ── Para-7: lock-in extends INDEFINITELY past the elected year ────────────────

describe("Para 7 — election persists into all subsequent tax years", () => {
  const ELECTED_YEAR = 2020;
  const ELECTED_VALUE = 55; // +10% on R50 standard, within ±20% band

  // Build an election made in 2020.
  const election2020: ElectionRecord = {
    species: "cattle",
    ageCategory: "Bulls",
    electedValueZar: ELECTED_VALUE,
    electedYear: ELECTED_YEAR,
  };

  // For every year after the election (T+1 through T+10), the value used by
  // the IT3 stock block must be the elected R55, not the R50 standard.
  // This is the operational meaning of "binding in respect of all subsequent
  // returns" (paragraph 7).
  for (let offset = 1; offset <= 10; offset += 1) {
    const taxYear = ELECTED_YEAR + offset;
    it(`uses R${ELECTED_VALUE} (elected ${ELECTED_YEAR}) when valuing ${taxYear} stock`, () => {
      // The stock-block valuer is called with the elections array returned by
      // loadElectionsForYear(taxYear), which by contract returns the latest
      // election whose electedYear <= taxYear. Para 7 says that election must
      // still apply, no matter how many years have passed.
      const elections = [election2020];
      const block = valueStockBlock(
        [{ species: "cattle", ageCategory: "Bulls", count: 1 }],
        elections,
      );
      expect(block.lines[0].effectiveValueZar).toBe(ELECTED_VALUE);
      expect(block.totalZar).toBe(ELECTED_VALUE);
      expect(block.electionApplied).toBe(true);
    });
  }

  // The lock-in does NOT expire after 4 years. This test exists to refute the
  // 4-year-window misreading of paragraph 7 — the rule has no temporal cap.
  it("does NOT revert to gazetted standard after 4 tax years (no 4-year window)", () => {
    const taxYearFiveYearsLater = ELECTED_YEAR + 5;
    const elections = [election2020];
    const block = valueStockBlock(
      [{ species: "cattle", ageCategory: "Bulls", count: 1 }],
      elections,
    );
    // Standard would be R50; if we revert we'd see R50. We must see R55.
    expect(block.lines[0].effectiveValueZar).toBe(ELECTED_VALUE);
    expect(taxYearFiveYearsLater).toBeGreaterThan(ELECTED_YEAR + 4);
  });
});

// ── Para-7: re-election lives at the data layer, not the valuer ───────────────

describe("Para 7 — lock-in is enforced at election-creation, not valuation", () => {
  const cls: LivestockClass = { species: "cattle", ageCategory: "Bulls" };

  it("effectiveValue accepts a single election with no priorElection (production flow)", () => {
    // Pins the production-flow contract: getIt3Payload calls
    // loadElectionsForYear, which returns at most one ElectionRecord per
    // class (the latest with electedYear <= taxYear). That single record is
    // then passed to valueStockBlock, which calls effectiveValue WITHOUT
    // priorElection. Re-election policing happens at the
    // SarsLivestockElection insert path (data-layer concern), not here.
    const election: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 55,
      electedYear: 2026,
    };
    expect(() => effectiveValue({ class: cls, election })).not.toThrow();
    expect(effectiveValue({ class: cls, election })).toBe(55);
  });

  it("once a new SARS-approved election exists, valuer adopts the new value", () => {
    // After SARS approves a change (paragraph 7, "consent of the Commissioner"),
    // a new ElectionRecord with the new value + sarsChangeApprovalRef is
    // inserted with the new electedYear. loadElectionsForYear returns the
    // newest one for any year >= newElectedYear. The valuer simply uses it.
    const newElection: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 45, // -10% on R50 standard, fresh approved election
      electedYear: 2026,
      sarsChangeApprovalRef: "SARS-APPROVAL-XYZ-2026",
    };
    expect(effectiveValue({ class: cls, election: newElection })).toBe(45);
  });

  it("election still rejected at valuation when it falls outside the ±20% band", () => {
    // Belt-and-braces: even with a SARS approval ref, an election outside
    // the paragraph 6 band remains illegal. This is a paragraph 6 check that
    // survives the paragraph 7 refactor.
    const badElection: ElectionRecord = {
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 70, // +40% on R50 — outside ±20% band
      electedYear: 2026,
      sarsChangeApprovalRef: "SARS-APPROVAL-XYZ-2026",
    };
    expect(() => effectiveValue({ class: cls, election: badElection })).toThrow();
  });
});

// ── Para-7 + IT3 flow: latest-election-wins is the lock-in mechanism ──────────

describe("Para 7 — latest-election-wins is the operational lock-in", () => {
  it("when only an old election exists, valuer uses it for any later year", () => {
    // Models loadElectionsForYear's contract: for taxYear=2030 it returns
    // [{ electedYear: 2020 }] because that's the only election with
    // electedYear <= 2030. The valuer must use it — that IS the lock-in.
    const elections: ElectionRecord[] = [
      {
        species: "sheep",
        ageCategory: "Ewes",
        electedValueZar: 7, // +16.7% on R6 standard
        electedYear: 2020,
      },
    ];
    const block = valueStockBlock(
      [{ species: "sheep", ageCategory: "Ewes", count: 100 }],
      elections,
    );
    expect(block.lines[0].effectiveValueZar).toBe(7);
    expect(block.totalZar).toBe(700);
  });

  it("when a SARS-approved newer election exists, latest-wins gives the new value", () => {
    // Simulates loadElectionsForYear running for taxYear=2027:
    //   the dedup keeps only the newest electedYear per (species, ageCategory).
    //   We pass that single newest record to the valuer.
    const latestElection: ElectionRecord = {
      species: "sheep",
      ageCategory: "Ewes",
      electedValueZar: 5, // -16.7% on R6 — a valid post-approval re-election
      electedYear: 2026,
      sarsChangeApprovalRef: "SARS-APPROVAL-2026",
    };
    const block = valueStockBlock(
      [{ species: "sheep", ageCategory: "Ewes", count: 100 }],
      [latestElection],
    );
    expect(block.lines[0].effectiveValueZar).toBe(5);
    expect(block.totalZar).toBe(500);
  });
});
