/**
 * @vitest-environment node
 *
 * Issue #394 (PRD #389 W5) — structural lock on the admin observation
 * presentation registry.
 *
 * Background
 * ──────────
 *   Before this lock, three independent structures in
 *   `components/admin/observations-log/` described each `ObservationType`:
 *
 *     - `TYPE_LABEL` in `constants.ts` — human label for the type
 *     - `parseDetails` switch in `parseDetails.ts` — JSON → summary line
 *     - `EditModal` per-type form dispatch in `EditModal.tsx`
 *
 *   The three drifted independently. Nine persistence-canonical types were
 *   missing from at least one of them, so the Basson admin observation
 *   history rendered raw enum identifiers like `SCROTAL_CIRCUMFERENCE` with a
 *   `"Details recorded"` placeholder, and the Edit modal could not present a
 *   form for those rows.
 *
 *   W5 unifies the three structures into a single `OBSERVATION_REGISTRY`
 *   keyed by the persistence-canonical observation type list
 *   (`OBSERVATION_TYPE_LIST` in `lib/domain/observations/registry.ts`).
 *
 * What this test locks
 * ────────────────────
 *   Every value in `OBSERVATION_TYPE_LIST` has an entry in
 *   `OBSERVATION_REGISTRY`. Adding a new observation type to the
 *   persistence allowlist without registering its label + detail-parser +
 *   editor form will fail this test.
 *
 *   Mirrors ADR-0006's structural discipline: no per-file allowlist, no
 *   pragma, no baseline. The mapped object type in `registry.ts`
 *   (`{ [T in ObservationType]: RegistryEntry<T> }`) gives the
 *   compile-time half of the lock; this test gives the runtime half.
 */
import { describe, it, expect } from "vitest";

import { OBSERVATION_TYPE_LIST } from "@/lib/domain/observations/registry";
import { OBSERVATION_REGISTRY } from "@/components/admin/observations-log/registry";

describe("observation presentation registry coverage", () => {
  it("registry has an entry for every persistence-canonical observation type", () => {
    const missing = OBSERVATION_TYPE_LIST.filter(
      (t) => !(t in OBSERVATION_REGISTRY),
    );
    expect(
      missing,
      [
        "OBSERVATION_REGISTRY is missing entries for the following persistence-canonical observation types:",
        ...missing.map((t) => `  - ${t}`),
        "",
        "Add an entry in `components/admin/observations-log/registry.ts`",
        "with a label, parseDetails(raw) summary builder, and a detailsForm",
        "component. The mapped object type `{ [T in ObservationType]: ... }`",
        "in that file is the compile-time half of this lock; this test is",
        "the runtime half.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("every registry entry has a non-empty label", () => {
    const bad: string[] = [];
    for (const t of OBSERVATION_TYPE_LIST) {
      const entry = OBSERVATION_REGISTRY[t];
      if (!entry || typeof entry.label !== "string" || entry.label.trim() === "") {
        bad.push(t);
      }
    }
    expect(bad, `Registry entries with empty labels: ${bad.join(", ")}`).toEqual([]);
  });

  it("every registry entry exposes a parseDetails function", () => {
    const bad: string[] = [];
    for (const t of OBSERVATION_TYPE_LIST) {
      const entry = OBSERVATION_REGISTRY[t];
      if (!entry || typeof entry.parseDetails !== "function") {
        bad.push(t);
      }
    }
    expect(
      bad,
      `Registry entries missing parseDetails: ${bad.join(", ")}`,
    ).toEqual([]);
  });

  it("every registry entry exposes a detailsForm component", () => {
    const bad: string[] = [];
    for (const t of OBSERVATION_TYPE_LIST) {
      const entry = OBSERVATION_REGISTRY[t];
      // React components are either functions or `forwardRef` objects with
      // `$$typeof`. Both pass typeof === "function" || "object".
      const hasForm =
        entry &&
        (typeof entry.detailsForm === "function" ||
          (typeof entry.detailsForm === "object" && entry.detailsForm !== null));
      if (!hasForm) {
        bad.push(t);
      }
    }
    expect(
      bad,
      `Registry entries missing detailsForm: ${bad.join(", ")}`,
    ).toEqual([]);
  });
});
