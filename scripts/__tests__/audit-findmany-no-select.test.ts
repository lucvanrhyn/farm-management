// @vitest-environment node
import { describe, it, expect } from "vitest";
import { auditSource, offenderKey, type Offender } from "../audit-findmany-no-select";

/**
 * `audit-findmany-no-select` is the column-projection sibling of
 * `audit-findmany-no-take`: same shape, different compliance rule. A
 * `prisma.<model>.findMany(...)` is compliant only if it carries a `select:`
 * or `omit:` clause that scopes the materialised columns. Bare findMany,
 * unique-where findMany, and take-only findMany are ALL offenders for this
 * check — none of them fix the basson-style "column declared in Prisma but
 * missing from live DB → 500" crash class. PRD #128 §14.
 */
describe("auditSource — column projection", () => {
  it("permits a findMany with explicit select", () => {
    const source = `await prisma.animal.findMany({ select: { id: true, name: true } });`;
    expect(auditSource("ok-select.ts", source)).toEqual([]);
  });

  it("permits a findMany with explicit omit", () => {
    // omit: is the inverse — exclude columns. Equally valid for projection.
    const source = `await prisma.animal.findMany({ omit: { speciesData: true } });`;
    expect(auditSource("ok-omit.ts", source)).toEqual([]);
  });

  it("flags an unprojected findMany even when it has take", () => {
    // Critical contract difference vs audit-findmany-no-take: `take:` is NOT
    // a compliance signal here. A bounded query that materialises every
    // column still crashes when a column is missing.
    const source = `await prisma.animal.findMany({ where: { species: "cattle" }, take: 50 });`;
    const offenders = auditSource("take-only.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].snippet).toContain("prisma.animal.findMany");
  });

  it("flags an unprojected findMany with unique-where", () => {
    const source = `await prisma.animal.findMany({ where: { id: "abc" } });`;
    expect(auditSource("unique-where.ts", source)).toHaveLength(1);
  });

  it("flags a bare findMany() with no arguments", () => {
    const source = `const all = await prisma.transaction.findMany();`;
    expect(auditSource("raw.ts", source)).toHaveLength(1);
  });

  it("flags each offender separately when multiple appear in one file", () => {
    const source = [
      `await prisma.a.findMany({ where: { species: "cattle" } });`,
      `await prisma.b.findMany({ select: { id: true } });`,
      `await prisma.c.findMany({ where: { id: "ok" } });`,
    ].join("\n");
    const offenders = auditSource("multi.ts", source);
    expect(offenders.map((o) => o.line).sort()).toEqual([1, 3]);
  });

  it("ignores findMany calls inside // line comments (documentation shape)", () => {
    // Same regression class as audit-findmany-no-take: a doc-comment showing
    // the old query shape must not get regex-matched as a real call.
    const source = [
      `// The previous regression shape:`,
      `//   const speciesAnimals = await prisma.animal.findMany({ where: { species: mode } ... })`,
      `expect(src).not.toMatch(/prisma\\.animal\\.findMany/);`,
    ].join("\n");
    expect(auditSource("commented.ts", source)).toEqual([]);
  });

  it("ignores findMany calls inside /* ... */ block comments", () => {
    const source = [
      `/*`,
      `  Old shape before we added select:`,
      `    await prisma.task.findMany({ where: { assigneeId: x } });`,
      `*/`,
      `await prisma.task.findMany({ select: { id: true } });`,
    ].join("\n");
    expect(auditSource("block.ts", source)).toEqual([]);
  });

  it("commented-out findMany does not advance the per-model occurrence counter", () => {
    const source = [
      `// await prisma.animal.findMany({ where: { species: mode } });`,
      `await prisma.animal.findMany({ where: { species: mode } });`,
    ].join("\n");
    const offenders = auditSource("counter.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].occurrenceIndex).toBe(0);
  });

  it("respects an audit-allow-findmany-no-select comment on the preceding line", () => {
    // Pragma name is distinct from audit-allow-findmany so that allowing one
    // dimension doesn't accidentally silence the other.
    const source = [
      `// audit-allow-findmany-no-select: bulk export needs every column`,
      `await prisma.observation.findMany({ where: { campId: "x" } });`,
    ].join("\n");
    expect(auditSource("allow.ts", source)).toEqual([]);
  });

  it("does NOT respect the legacy audit-allow-findmany pragma (different concern)", () => {
    // The two audits cover different bug classes. The legacy pragma was
    // written for "explain why this is unbounded" — it doesn't carry any
    // claim about column projection, so reusing it would let the basson
    // class slip through unannotated.
    const source = [
      `// audit-allow-findmany: intentional full scan for analytics`,
      `await prisma.observation.findMany({ where: { campId: "x" } });`,
    ].join("\n");
    const offenders = auditSource("wrong-allow.ts", source);
    expect(offenders).toHaveLength(1);
  });

  it("does not match method calls on unrelated receivers", () => {
    const source = `
      const rows = await db.items.findMany({ where: { species: mode } });
      const list = await repo.findMany();
    `;
    expect(auditSource("other.ts", source)).toEqual([]);
  });

  it("handles multi-line findMany calls by reading the full balanced-brace argument", () => {
    const source = [
      `const animals = await prisma.animal.findMany({`,
      `  where: { species: mode },`,
      `  orderBy: [{ category: "asc" }, { animalId: "asc" }],`,
      `});`,
    ].join("\n");
    const offenders = auditSource("multiline.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].line).toBe(1);
  });

  it("permits a multi-line findMany that contains select: deeper in the argument", () => {
    const source = [
      `await prisma.animal.findMany({`,
      `  where: { species: mode },`,
      `  select: { id: true, name: true },`,
      `});`,
    ].join("\n");
    expect(auditSource("multiline-select.ts", source)).toEqual([]);
  });

  it("does not match select: keys in nested where filters as compliance", () => {
    // Regression guard: the compliance regex must require select to be a
    // top-level key of the args, not a nested predicate (e.g. `where: {
    // metadata: { select: ... } }` would falsely satisfy a naive substring
    // check). The brace-aware matcher should require the boundary prefix.
    const source = [
      `await prisma.metric.findMany({`,
      `  where: { metadata: { contains: '"select":"all"' } },`,
      `});`,
    ].join("\n");
    const offenders = auditSource("nested.ts", source);
    expect(offenders).toHaveLength(1);
  });
});

describe("offenderKey", () => {
  it("composes a stable `path::model::occurrenceIndex` string for baseline diffing", () => {
    const o: Offender = {
      path: "foo/bar.ts",
      line: 42,
      snippet: "…",
      modelName: "animal",
      occurrenceIndex: 0,
    };
    expect(offenderKey(o)).toBe("foo/bar.ts::animal::0");
  });
});
