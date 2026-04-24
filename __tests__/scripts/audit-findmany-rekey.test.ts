// @vitest-environment node
/**
 * Tests for the re-keyed audit baseline.
 *
 * PR #11 (P1) wrapped `prisma.*.findMany(...)` calls in `timeAsync("query", () => ...)`,
 * drifting the line numbers of five already-grandfathered offenders by 1-5 lines.
 * The baseline keyed on `path:line`, so CI saw the drifted calls as brand-new
 * offenders and failed every push to main.
 *
 * The fix is to re-key the baseline on `path::modelName::occurrenceIndex`:
 *   - `path` — relative path from repo root
 *   - `modelName` — the Prisma delegate (`task`, `taskOccurrence`, `farmSpeciesSettings`...)
 *   - `occurrenceIndex` — the 0-based index of this call among all calls to the
 *     same model in the same file (tracks multiple calls to the same delegate)
 *
 * This key is stable under pure formatting/line-drift edits and only changes
 * when a) a new model is queried, b) a new call to an existing model is added,
 * or c) a call is moved to a different file.
 */
import { describe, it, expect } from "vitest";
import {
  auditSource,
  offenderKey,
  migrateBaselineEntries,
  type Offender,
} from "../../scripts/audit-findmany-no-take";

describe("auditSource — offender shape", () => {
  it("emits a modelName on each offender", () => {
    const source = `await prisma.animal.findMany({ where: { species: "cattle" } });`;
    const offenders = auditSource("bad.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].modelName).toBe("animal");
  });

  it("emits occurrenceIndex=0 for the first call to a model and increments for repeats", () => {
    const source = [
      `await prisma.animal.findMany({ where: { species: "cattle" } });`,
      `await prisma.animal.findMany({ where: { species: "sheep" } });`,
      `await prisma.animal.findMany({ where: { species: "goat" } });`,
    ].join("\n");
    const offenders = auditSource("many.ts", source);
    expect(offenders).toHaveLength(3);
    expect(offenders.map((o) => o.occurrenceIndex)).toEqual([0, 1, 2]);
  });

  it("keys two different models in one file distinctly starting at 0 each", () => {
    // Mirrors `app/api/tasks/route.ts` which has `task.findMany` and `taskOccurrence.findMany`.
    const source = [
      `await prisma.taskOccurrence.findMany({ where: { campId: "x" } });`,
      `await prisma.task.findMany({ where: { campId: "x" } });`,
    ].join("\n");
    const offenders = auditSource("app/api/tasks/route.ts", source);
    expect(offenders).toHaveLength(2);

    const keyed = offenders.map(offenderKey).sort();
    expect(keyed).toEqual([
      "app/api/tasks/route.ts::task::0",
      "app/api/tasks/route.ts::taskOccurrence::0",
    ]);
  });
});

describe("offenderKey", () => {
  it("composes `path::modelName::occurrenceIndex`", () => {
    const o: Offender = {
      path: "app/api/tasks/route.ts",
      line: 70,
      snippet: "",
      modelName: "taskOccurrence",
      occurrenceIndex: 0,
    };
    expect(offenderKey(o)).toBe("app/api/tasks/route.ts::taskOccurrence::0");
  });
});

describe("baseline stability — a) line drift is invisible", () => {
  it("matches the same model-indexed key even when findMany drifts by +5 lines", () => {
    const before = `await prisma.farmSpeciesSettings.findMany();`;

    // Same call wrapped in timeAsync and padded with 5 extra lines — exactly
    // the P1 refactor pattern.
    const after = [
      `// preamble`,
      `// more preamble`,
      `// more preamble`,
      `// more preamble`,
      `const settings = await timeAsync("query", () =>`,
      `  prisma.farmSpeciesSettings.findMany()`,
      `);`,
    ].join("\n");

    const beforeKey = offenderKey(auditSource("layout.tsx", before)[0]);
    const afterKey = offenderKey(auditSource("layout.tsx", after)[0]);

    expect(afterKey).toBe(beforeKey);
    expect(beforeKey).toBe("layout.tsx::farmSpeciesSettings::0");
  });
});

describe("baseline stability — b) genuinely new calls are still reported", () => {
  it("a new model call in a previously-unflagged file is reported", () => {
    const source = `await prisma.payment.findMany({ where: { status: "pending" } });`;
    const offenders = auditSource("lib/server/new-feature.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenderKey(offenders[0])).toBe(
      "lib/server/new-feature.ts::payment::0",
    );
  });

  it("a second call to an existing model in a previously-flagged file is reported", () => {
    const source = [
      `await prisma.animal.findMany({ where: { species: "cattle" } });`,
      `await prisma.animal.findMany({ where: { species: "sheep" } });`,
    ].join("\n");
    const offenders = auditSource("existing.ts", source);
    const keys = offenders.map(offenderKey);
    expect(keys).toEqual([
      "existing.ts::animal::0",
      "existing.ts::animal::1",
    ]);
  });
});

describe("baseline stability — c) two models in one file keyed distinctly", () => {
  it("task.findMany and taskOccurrence.findMany in the same file get separate keys", () => {
    // Mirrors the structure of app/api/tasks/route.ts in the real codebase.
    const source = [
      `const occurrences = await timeAsync("query", () =>`,
      `  prisma.taskOccurrence.findMany({`,
      `    where: { occurrenceAt: { gte: from } },`,
      `  })`,
      `);`,
      ``,
      `const tasks = await timeAsync("query", () =>`,
      `  prisma.task.findMany({`,
      `    where,`,
      `  })`,
      `);`,
    ].join("\n");

    const offenders = auditSource("app/api/tasks/route.ts", source);
    const keys = offenders.map(offenderKey).sort();
    expect(keys).toEqual([
      "app/api/tasks/route.ts::task::0",
      "app/api/tasks/route.ts::taskOccurrence::0",
    ]);
  });
});

describe("baseline migration — d) old path:line entries upgrade cleanly", () => {
  it("migrates a legacy `path:line` baseline entry to `path::model::0` using current source", () => {
    // Simulate the on-disk state: baseline remembers the pre-P1 line, source now has drifted.
    const legacyBaseline = [
      "app/api/tasks/route.ts:67",
      "app/api/tasks/route.ts:110",
      "app/[farmSlug]/layout.tsx:24",
    ];

    // Fake repo snapshot keyed by relative path; the migrator should audit each
    // file and match legacy lines to live offenders.
    const repo = new Map<string, string>([
      [
        "app/api/tasks/route.ts",
        [
          // pad 69 blank lines so `taskOccurrence.findMany` lands at line 70
          ...Array.from({ length: 69 }, () => ""),
          `  prisma.taskOccurrence.findMany({ where: { occurrenceAt: {} } });`,
          // pad to line 115 for `task.findMany`
          ...Array.from({ length: 44 }, () => ""),
          `  prisma.task.findMany({ where: {} });`,
        ].join("\n"),
      ],
      [
        "app/[farmSlug]/layout.tsx",
        [
          ...Array.from({ length: 24 }, () => ""),
          `const settings = await prisma.farmSpeciesSettings.findMany();`,
        ].join("\n"),
      ],
    ]);

    const migrated = migrateBaselineEntries(legacyBaseline, repo);

    expect(migrated.sort()).toEqual(
      [
        "app/[farmSlug]/layout.tsx::farmSpeciesSettings::0",
        "app/api/tasks/route.ts::task::0",
        "app/api/tasks/route.ts::taskOccurrence::0",
      ].sort(),
    );
  });

  it("passes through already-new-format entries unchanged", () => {
    const legacyBaseline = ["foo/bar.ts::animal::0"];
    const repo = new Map<string, string>();
    expect(migrateBaselineEntries(legacyBaseline, repo)).toEqual([
      "foo/bar.ts::animal::0",
    ]);
  });
});

describe("baseline stability — e) removed allowlisted calls clear cleanly", () => {
  it("when source no longer contains the offending findMany, it's not reported", () => {
    // The baseline still has an entry, but the code has been fixed (added `take:`)
    // — audit should produce no offender at all, so the baseline entry is
    // simply stale (shrink-only, never grows).
    const source = `await prisma.animal.findMany({ where: { species: "cattle" }, take: 100 });`;
    const offenders = auditSource("fixed.ts", source);
    expect(offenders).toEqual([]);
  });
});
