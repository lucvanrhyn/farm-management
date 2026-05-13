// @vitest-environment node
/**
 * __tests__/scripts/audit-animal-list-deceased-flag.test.ts
 *
 * Behaviour test for `audit-animal-list-deceased-flag` — the structural
 * lint that enforces "every per-species animal LIST/SEARCH query commits
 * to a lifecycle (status) decision rather than silently inheriting one".
 *
 * Issue #255 (Wave 4 of PRD #250). Sibling of `audit-species-where` (PRD
 * #222 / issue #224) which enforces the species axis. This audit covers
 * the deceased-rows-leaking-out class.
 *
 * The bug class (production stress test 2026-05-13):
 *
 *   const animals = await scoped(prisma, mode).animal.findMany({});
 *
 * `scoped(...)` injects `status: "Active"` by default. A new catalogue /
 * search / mortality-list surface that goes through the facade silently
 * EXCLUDES every deceased row — code review can't catch this because
 * the call typechecks and returns rows.
 *
 * Compliant patterns:
 *   1. The call goes through `searchAnimals(...)` from
 *      `lib/server/animal-search.ts`. The deep module's signature
 *      requires `includeDeceased: boolean`, so the lifecycle decision
 *      is made by TypeScript, not by accident.
 *   2. The call carries `status:` explicitly in its `where` (any value
 *      — Active / Sold / Deceased / `{ in: [...] }` — counts as a
 *      deliberate lifecycle choice).
 *   3. An `// audit-allow-deceased-flag: <reason>` pragma on the
 *      preceding line silences a specific call that needs raw-prisma
 *      (e.g. counts inside the AnimalSearchQuery module itself).
 *   4. Calls grandfathered in `.audit-animal-list-deceased-flag-baseline.json`.
 */
import { describe, it, expect } from 'vitest';
import {
  auditSource,
  offenderKey,
  type Offender,
} from '../../scripts/audit-animal-list-deceased-flag';

describe('auditSource — animal lifecycle predicate enforcement', () => {
  it('flags scoped(...).animal.findMany with no status predicate (the BB-C013 bug shape)', () => {
    // The exact prod regression shape: scoped facade injects status:Active
    // and the catalogue surface silently excludes deceased rows.
    const source = `await scoped(prisma, mode).animal.findMany({ where: { currentCamp: "X" } });`;
    const offenders = auditSource('flag.ts', source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].callShape).toBe('scoped');
    expect(offenders[0].operation).toBe('findMany');
  });

  it('flags scoped(...).animal.findMany with empty args', () => {
    const source = `await scoped(prisma, mode).animal.findMany({});`;
    expect(auditSource('empty.ts', source)).toHaveLength(1);
  });

  it('flags scoped(...).animal.findMany with no args at all', () => {
    const source = `await scoped(prisma, mode).animal.findMany();`;
    expect(auditSource('no-args.ts', source)).toHaveLength(1);
  });

  it('permits scoped().animal.findMany when caller carries explicit status', () => {
    // An explicit status decision (any value) is compliant. The bug class
    // is the *unstated* lifecycle inheritance, not the lifecycle choice.
    const source = `await scoped(prisma, mode).animal.findMany({ where: { status: "Sold" } });`;
    expect(auditSource('explicit.ts', source)).toEqual([]);
  });

  it('permits an explicit status: "Deceased" filter', () => {
    const source = `await scoped(prisma, mode).animal.findMany({ where: { status: "Deceased" } });`;
    expect(auditSource('deceased.ts', source)).toEqual([]);
  });

  it('permits status: { in: [...] } as a deliberate lifecycle choice', () => {
    const source = `await scoped(prisma, mode).animal.findMany({ where: { status: { in: ["Active", "Sold"] } } });`;
    expect(auditSource('union.ts', source)).toEqual([]);
  });

  it('flags raw prisma.animal.findMany when listing without a status predicate', () => {
    // The raw-prisma path through the species facade is also covered —
    // a developer who bypasses `scoped(...)` for the species axis but
    // forgets the status axis is still in the bug class.
    // audit-allow-findmany: template-literal test fixture for the deceased-flag audit; not a real Prisma call.
    const source = `await prisma.animal.findMany({ where: { species: mode, currentCamp: "X" } });`;
    expect(auditSource('raw.ts', source)).toHaveLength(1);
  });

  it('respects an audit-allow-deceased-flag pragma on the preceding line', () => {
    const source = [
      `// audit-allow-deceased-flag: birthday backfill iterates every animal regardless of status`,
      `await scoped(prisma, mode).animal.findMany({});`,
    ].join('\n');
    expect(auditSource('pragma.ts', source)).toEqual([]);
  });

  it('pragma is name-specific: audit-allow-species-where does NOT silence this audit', () => {
    // Each audit covers a distinct bug class — re-using one pragma for all
    // would let the lifecycle axis slip through unannotated. Mirror of
    // audit-species-where's pragma-specificity rule.
    const source = [
      `// audit-allow-species-where: cross-species farm-wide total`,
      `await scoped(prisma, mode).animal.findMany({});`,
    ].join('\n');
    expect(auditSource('wrong-pragma.ts', source)).toHaveLength(1);
  });

  it('does not match findMany inside // line comments', () => {
    const source = [
      `// historical:`,
      `//   await scoped(prisma, mode).animal.findMany({});`,
      `await scoped(prisma, mode).animal.findMany({ where: { status: "Active" } });`,
    ].join('\n');
    expect(auditSource('commented.ts', source)).toEqual([]);
  });

  it('does not match findMany inside /* ... */ block comments', () => {
    const source = [
      `/*`,
      `  Pre-#255:`,
      `    await scoped(prisma, mode).animal.findMany({});`,
      `*/`,
      `await scoped(prisma, mode).animal.findMany({ where: { status: "Active" } });`,
    ].join('\n');
    expect(auditSource('block.ts', source)).toEqual([]);
  });

  it('does not match calls that go through searchAnimals (the deep module is the cure)', () => {
    // searchAnimals's signature requires `includeDeceased`, so the call
    // is compliant by construction. The audit must not flag it.
    const source = `await searchAnimals(prisma, { mode, includeDeceased: true });`;
    expect(auditSource('search.ts', source)).toEqual([]);
  });

  it('does not match countAnimalsByStatus (lifecycle is the explicit return shape)', () => {
    const source = `await countAnimalsByStatus(prisma, mode);`;
    expect(auditSource('count.ts', source)).toEqual([]);
  });

  it('does not match calls on non-prisma / non-scoped receivers', () => {
    const source = `await repo.animal.findMany({});`;
    expect(auditSource('repo.ts', source)).toEqual([]);
  });

  it('does not match findFirst by primary key (single-row lookup is not a list)', () => {
    // findFirst targeting a unique key is a lookup, not a list. The
    // lifecycle axis only matters for set-returning operations (findMany).
    const source = `await scoped(prisma, mode).animal.findFirst({ where: { animalId: "BB-C013" } });`;
    expect(auditSource('lookup.ts', source)).toEqual([]);
  });

  it('does not flag count operations (counts opt into status by adding it)', () => {
    // count() is governed by audit-species-where for the species axis;
    // the lifecycle-axis bug class is specifically about list/search
    // surfaces returning rows the user expected to see.
    const source = `await scoped(prisma, mode).animal.count();`;
    expect(auditSource('count.ts', source)).toEqual([]);
  });

  it('flags each violation independently when multiple appear in one file', () => {
    const source = [
      `await scoped(prisma, mode).animal.findMany({});`,
      `await scoped(prisma, mode).animal.findMany({ where: { status: "Active" } });`,
      `await scoped(prisma, mode).animal.findMany({ where: { currentCamp: "Y" } });`,
    ].join('\n');
    const offenders = auditSource('multi.ts', source);
    expect(offenders).toHaveLength(2);
    expect(offenders.map((o) => o.line).sort()).toEqual([1, 3]);
  });

  it('handles multi-line scoped().animal.findMany calls', () => {
    const source = [
      `await scoped(prisma, mode).animal.findMany({`,
      `  orderBy: { animalId: "asc" },`,
      `  take: 50,`,
      `});`,
    ].join('\n');
    expect(auditSource('multi-line.ts', source)).toHaveLength(1);
  });

  it('permits a multi-line call with status nested deeper in the where', () => {
    const source = [
      `await scoped(prisma, mode).animal.findMany({`,
      `  where: {`,
      `    currentCamp: "X",`,
      `    status: "Active",`,
      `  },`,
      `});`,
    ].join('\n');
    expect(auditSource('multi-ok.ts', source)).toEqual([]);
  });
});

describe('offenderKey', () => {
  it('composes a stable `path::callShape::operation::occurrenceIndex` for baseline diffing', () => {
    const o: Offender = {
      path: 'foo/bar.ts',
      line: 7,
      snippet: '…',
      callShape: 'scoped',
      operation: 'findMany',
      occurrenceIndex: 0,
    };
    expect(offenderKey(o)).toBe('foo/bar.ts::scoped::findMany::0');
  });
});
