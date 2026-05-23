/**
 * @vitest-environment node
 *
 * Issue #391 (W3 of PRD #389) — table-driven tests for
 * `canPerformLoggerAction(animal, action)`.
 *
 * The predicate is the single source of truth for which Logger action
 * buttons are enabled per animal. These tests pin both the explicit
 * acceptance criteria from the issue and every cell of the
 * (sex × category × action) matrix the predicate is responsible for.
 *
 * Two layers of coverage:
 *
 *   1. Explicit acceptance-criteria cases from the issue body (the smallest
 *      set Luc signed off on).
 *   2. A full table-driven sweep across every interesting (sex × category)
 *      pair for `calving` + `reproduction` so a future refactor that
 *      flips a single rule cannot pass without a failing test.
 *
 * The unconditional actions (`health`, `weigh`, `treat`, `movement`,
 * `death`) get their own sweep so the predicate's default branch is
 * pinned too — accidentally returning `{ allowed: false }` for a
 * `weigh` action would silently disable every weigh button.
 */
import { describe, it, expect } from "vitest";
import {
  canPerformLoggerAction,
  type LoggerAction,
  type LoggerActionAnimal,
} from "./canPerformAction";

// ─── Acceptance-criteria cases (issue #391) ──────────────────────────────────
//
// These are the seven cases Luc enumerated in the issue. They are repeated
// (rather than just folded into the matrix below) so a future contributor
// reading the failure log sees the original spec, not just a coordinate.

describe("canPerformLoggerAction — acceptance criteria (#391)", () => {
  const cases: Array<{
    name: string;
    animal: LoggerActionAnimal;
    action: LoggerAction;
    expectAllowed: boolean;
  }> = [
    {
      name: "Bull + calving → blocked",
      animal: { sex: "Male", category: "Bull" },
      action: "calving",
      expectAllowed: false,
    },
    {
      name: "Cow + calving → allowed",
      animal: { sex: "Female", category: "Cow" },
      action: "calving",
      expectAllowed: true,
    },
    {
      name: "Calf + reproduction → blocked",
      animal: { sex: "Female", category: "Calf" },
      action: "reproduction",
      expectAllowed: false,
    },
    {
      name: "Lamb + reproduction → blocked",
      animal: { sex: "Female", category: "Lamb" },
      action: "reproduction",
      expectAllowed: false,
    },
    {
      name: "Ewe Lamb + calving → blocked",
      animal: { sex: "Female", category: "Ewe Lamb" },
      action: "calving",
      expectAllowed: false,
    },
    {
      name: "Maiden Ewe + reproduction → allowed",
      animal: { sex: "Female", category: "Maiden Ewe" },
      action: "reproduction",
      expectAllowed: true,
    },
    {
      name: "Ewe + calving → allowed",
      animal: { sex: "Female", category: "Ewe" },
      action: "calving",
      expectAllowed: true,
    },
  ];

  it.each(cases)("$name", ({ animal, action, expectAllowed }) => {
    const result = canPerformLoggerAction(animal, action);
    expect(result.allowed).toBe(expectAllowed);
    if (!expectAllowed) {
      // Reason must be a human-readable, non-empty string the UI can show
      // as a tooltip / aria-description.
      expect("reason" in result && result.reason.length > 0).toBe(true);
    }
  });
});

// ─── Calving — full sex × category sweep ─────────────────────────────────────
//
// Rule: calving requires `sex === "Female"` AND category NOT in
// {Calf, Lamb, Ewe Lamb, Maiden Ewe}.

describe("canPerformLoggerAction — calving rule", () => {
  const adultFemaleCategories = ["Cow", "Heifer", "Ewe", "Hogget", "Adult Female"];
  const adultMaleCategories = ["Bull", "Ox", "Ram", "Wether", "Adult Male"];
  const blockedCategories = ["Calf", "Lamb", "Ewe Lamb", "Maiden Ewe"];

  it.each(adultFemaleCategories)(
    "Female %s is allowed to calve",
    (category) => {
      const result = canPerformLoggerAction(
        { sex: "Female", category },
        "calving",
      );
      expect(result.allowed).toBe(true);
    },
  );

  it.each(adultMaleCategories)(
    "Male %s is blocked from calving (wrong sex)",
    (category) => {
      const result = canPerformLoggerAction(
        { sex: "Male", category },
        "calving",
      );
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason.toLowerCase()).toContain("female");
      }
    },
  );

  it.each(blockedCategories)(
    "Female %s is blocked from calving (juvenile / pre-parturient)",
    (category) => {
      const result = canPerformLoggerAction(
        { sex: "Female", category },
        "calving",
      );
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        // Reason should name the category so the farmer sees *why*.
        expect(result.reason).toContain(category);
      }
    },
  );

  it("Male + juvenile category — sex blocks first (returns sex reason)", () => {
    // For a male calf the sex check is hit before the category check.
    // Either reason is acceptable as long as `allowed === false`; we pin
    // the order here so the UX tooltip is deterministic.
    const result = canPerformLoggerAction(
      { sex: "Male", category: "Calf" },
      "calving",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason.toLowerCase()).toContain("female");
    }
  });
});

// ─── Reproduction — full category sweep ──────────────────────────────────────
//
// Rule: reproduction requires category NOT in {Calf, Lamb, Ewe Lamb}.
// Sex does not matter — bulls/rams can mate, cows/ewes can mate.

describe("canPerformLoggerAction — reproduction rule", () => {
  const allowedCategories = [
    "Cow",
    "Bull",
    "Heifer",
    "Ox",
    "Ewe",
    "Ram",
    "Wether",
    "Hogget",
    "Maiden Ewe",
    "Adult Male",
    "Adult Female",
    "Sub-adult",
  ];
  const blockedCategories = ["Calf", "Lamb", "Ewe Lamb"];

  it.each(allowedCategories)(
    "Female %s is allowed to log reproduction",
    (category) => {
      const result = canPerformLoggerAction(
        { sex: "Female", category },
        "reproduction",
      );
      expect(result.allowed).toBe(true);
    },
  );

  it.each(allowedCategories)(
    "Male %s is allowed to log reproduction",
    (category) => {
      const result = canPerformLoggerAction(
        { sex: "Male", category },
        "reproduction",
      );
      expect(result.allowed).toBe(true);
    },
  );

  it.each(blockedCategories)(
    "Female %s is blocked from reproduction (sexually immature)",
    (category) => {
      const result = canPerformLoggerAction(
        { sex: "Female", category },
        "reproduction",
      );
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain(category);
      }
    },
  );

  it.each(blockedCategories)(
    "Male %s is blocked from reproduction (sexually immature)",
    (category) => {
      const result = canPerformLoggerAction(
        { sex: "Male", category },
        "reproduction",
      );
      expect(result.allowed).toBe(false);
    },
  );
});

// ─── Unconditional actions ───────────────────────────────────────────────────
//
// Rule: every action other than calving / reproduction is allowed for any
// (sex, category) pair. This sweep pins the default branch — if a future
// refactor accidentally returns `{ allowed: false }` for `weigh` it shows
// up here, not in a Playwright run a week later.

describe("canPerformLoggerAction — unconditional actions", () => {
  const unconditional: LoggerAction[] = [
    "health",
    "weigh",
    "treat",
    "movement",
    "death",
  ];
  const animals: LoggerActionAnimal[] = [
    { sex: "Female", category: "Cow" },
    { sex: "Male", category: "Bull" },
    { sex: "Female", category: "Calf" },
    { sex: "Male", category: "Lamb" },
    { sex: "Female", category: "Ewe Lamb" },
    { sex: "Female", category: "Maiden Ewe" },
    { sex: "Female", category: "Ewe" },
    { sex: "Male", category: "Ram" },
    { sex: "Female", category: "Adult Female" },
    { sex: "Male", category: "Sub-adult" },
  ];

  for (const action of unconditional) {
    it.each(animals)(
      `${action} on (%o) is always allowed`,
      (animal) => {
        const result = canPerformLoggerAction(animal, action);
        expect(result.allowed).toBe(true);
      },
    );
  }
});
