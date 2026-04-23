// @vitest-environment node
import { describe, it, expect } from "vitest";
import { auditSource, offenderKey, type Offender } from "../audit-findmany-no-take";

/**
 * The audit helper is a pure string → offender[] function. Tests therefore
 * exercise the analyser on hand-rolled source snippets rather than real files,
 * which keeps them hermetic and fast (the full repo scan is reserved for the
 * CLI entry-point).
 */
describe("auditSource", () => {
  it("reports zero offenders on compliant snippets", () => {
    const source = `
      const a = await prisma.animal.findMany({ take: 50 });
      const b = await prisma.animal.findMany({ where: { id: "abc" } });
      const c = await prisma.observation.findMany({ where: { animalId: "x" } });
      const d = await prisma.camp.findMany({ where: { slug: "trio-b" } });
    `;
    const offenders = auditSource("ok.ts", source);
    expect(offenders).toEqual([]);
  });

  it("flags an unbounded findMany with a non-unique where", () => {
    const source = `await prisma.animal.findMany({ where: { species: mode }, orderBy: { animalId: "asc" } });`;
    const offenders: Offender[] = auditSource("bad.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].path).toBe("bad.ts");
    expect(offenders[0].line).toBe(1);
    expect(offenders[0].snippet).toContain("prisma.animal.findMany");
  });

  it("flags a findMany with no arguments at all", () => {
    const source = `const all = await prisma.transaction.findMany();`;
    const offenders = auditSource("raw.ts", source);
    expect(offenders).toHaveLength(1);
  });

  it("permits a unique-column lookup without take", () => {
    const source = `
      await prisma.animal.findMany({
        where: { id: someId },
      });
    `;
    const offenders = auditSource("unique.ts", source);
    expect(offenders).toEqual([]);
  });

  it("permits an explicit take: anywhere in the call", () => {
    const source = `
      await prisma.observation.findMany({
        where: { campId: "x" },
        orderBy: { observedAt: "desc" },
        take: 15,
      });
    `;
    const offenders = auditSource("take.ts", source);
    expect(offenders).toEqual([]);
  });

  it("flags each offender separately when multiple appear in one file", () => {
    const source = [
      `await prisma.a.findMany({ where: { species: "cattle" } });`,
      `await prisma.b.findMany({ where: { campId: "x" } });`,
      `await prisma.c.findMany({ where: { id: "ok" } });`,
    ].join("\n");
    const offenders = auditSource("multi.ts", source);
    expect(offenders.map((o) => o.line).sort()).toEqual([1, 2]);
  });

  it("respects an allow-comment on the preceding line", () => {
    const source = [
      `// audit-allow-findmany: intentional full scan for analytics`,
      `await prisma.observation.findMany({ where: { campId: "x" } });`,
    ].join("\n");
    const offenders = auditSource("allow.ts", source);
    expect(offenders).toEqual([]);
  });

  it("does not match method calls on unrelated receivers", () => {
    const source = `
      const rows = await db.items.findMany({ where: { species: mode } });
      const list = await repo.findMany();
    `;
    const offenders = auditSource("other.ts", source);
    expect(offenders).toEqual([]);
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

  it("permits a multi-line findMany that contains take: deeper in the argument", () => {
    const source = [
      `await prisma.animal.findMany({`,
      `  where: { species: mode },`,
      `  take: 50,`,
      `});`,
    ].join("\n");
    const offenders = auditSource("multiline-take.ts", source);
    expect(offenders).toEqual([]);
  });
});

describe("offenderKey", () => {
  it("composes a stable `path:line` string for baseline diffing", () => {
    const o: Offender = { path: "foo/bar.ts", line: 42, snippet: "…" };
    expect(offenderKey(o)).toBe("foo/bar.ts:42");
  });
});
