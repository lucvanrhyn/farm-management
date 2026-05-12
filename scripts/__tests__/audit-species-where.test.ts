// @vitest-environment node
/**
 * scripts/__tests__/audit-species-where.test.ts
 *
 * Behaviour test for `audit-species-where` — the structural lint that
 * enforces "every per-species-scoped Prisma call must commit to the species
 * axis". PRD #222 / issue #224.
 *
 * The audit's siblings (`audit-findmany-no-take`, `audit-findmany-no-select`)
 * are precedent. This file mirrors their assertion style:
 *
 *   - A `prisma.<model>.<op>` call where model is in the per-species set
 *     (animal, camp, mob, observation) and the args don't carry a top-level
 *     `species:` key is an offender.
 *   - A call routed through `scoped(prisma, mode).<model>.<op>` is compliant
 *     by construction (the facade injects species, so the call literal in
 *     source doesn't need it).
 *   - An `// audit-allow-species-where: <reason>` pragma on the preceding
 *     line silences a specific call (cross-species deliberate spans).
 */
import { describe, it, expect } from 'vitest';
import { auditSource, offenderKey, type Offender } from '../audit-species-where';

describe('auditSource — species predicate enforcement', () => {
  it('permits a findMany that carries top-level species in where', () => {
    const source = `await prisma.animal.findMany({ where: { species: "cattle", status: "Active" } });`;
    expect(auditSource('ok.ts', source)).toEqual([]);
  });

  it('flags a findMany missing the species predicate', () => {
    const source = `await prisma.animal.findMany({ where: { status: "Active" } });`;
    const offenders = auditSource('flag.ts', source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].modelName).toBe('animal');
    expect(offenders[0].operation).toBe('findMany');
  });

  it('flags a bare findMany() with no args', () => {
    const source = `await prisma.animal.findMany();`;
    expect(auditSource('bare.ts', source)).toHaveLength(1);
  });

  it('flags a count call missing species', () => {
    // count() is just as load-bearing as findMany — a per-species view that
    // counts without filtering by species will show cross-tenant totals.
    const source = `await prisma.animal.count({ where: { status: "Active" } });`;
    expect(auditSource('count.ts', source)).toHaveLength(1);
  });

  it('flags camp.findMany missing species', () => {
    const source = `await prisma.camp.findMany({ orderBy: { campName: "asc" } });`;
    expect(auditSource('camp.ts', source)).toHaveLength(1);
  });

  it('flags mob.findMany missing species', () => {
    const source = `await prisma.mob.findMany({});`;
    expect(auditSource('mob.ts', source)).toHaveLength(1);
  });

  it('flags observation.findMany missing species', () => {
    // Observation.species is the denormalised column added in migration
    // 0003; per-species observation feeds must filter on it.
    const source = `await prisma.observation.findMany({ where: { type: "weighing" } });`;
    expect(auditSource('obs.ts', source)).toHaveLength(1);
  });

  it('does not match prisma models outside the per-species set', () => {
    // Transaction, FarmSettings, Notification, etc. are farm-scoped not
    // species-scoped. The audit must not false-positive on them.
    const source = [
      `await prisma.transaction.findMany({ where: { date: "2026" } });`,
      `await prisma.farmSettings.findFirst();`,
      `await prisma.notification.count({ where: { isRead: false } });`,
    ].join('\n');
    expect(auditSource('out-of-scope.ts', source)).toEqual([]);
  });

  it('does not match calls on non-prisma receivers', () => {
    const source = `await repo.animal.findMany({ where: { status: "Active" } });`;
    expect(auditSource('repo.ts', source)).toEqual([]);
  });

  it('treats calls routed through scoped(...) as compliant (no `prisma.` literal)', () => {
    // The facade is the cure. A call written `scoped(prisma, mode).animal.findMany(...)`
    // doesn't match the `prisma.<model>` regex at all — by construction
    // it can't be unscoped. This test pins that the audit doesn't somehow
    // catch the receiver chain anyway.
    const source = `await scoped(prisma, mode).animal.findMany({ where: { status: "Active" } });`;
    expect(auditSource('scoped.ts', source)).toEqual([]);
  });

  it('respects an audit-allow-species-where pragma on the preceding line', () => {
    const source = [
      `// audit-allow-species-where: dashboard total spans species by design`,
      `await prisma.animal.count({ where: { status: "Active" } });`,
    ].join('\n');
    expect(auditSource('pragma.ts', source)).toEqual([]);
  });

  it('pragma is name-specific: audit-allow-findmany does NOT silence this audit', () => {
    // Each audit covers a distinct bug class — re-using one pragma for all
    // would let the species axis slip through unannotated. Mirror of the
    // same rule in audit-findmany-no-select.
    const source = [
      `// audit-allow-findmany: bounded by camp filter`,
      `await prisma.animal.findMany({ where: { currentCamp: "X" } });`,
    ].join('\n');
    expect(auditSource('wrong-pragma.ts', source)).toHaveLength(1);
  });

  it('does not match findMany inside // line comments', () => {
    const source = [
      `// historical:`,
      `//   await prisma.animal.findMany({ where: { status: "Active" } });`,
      `await prisma.animal.findMany({ where: { species: mode } });`,
    ].join('\n');
    expect(auditSource('commented.ts', source)).toEqual([]);
  });

  it('does not match findMany inside /* ... */ block comments', () => {
    const source = [
      `/*`,
      `  Before #224:`,
      `    await prisma.animal.findMany({ where: { status: "Active" } });`,
      `*/`,
      `await prisma.animal.findMany({ where: { species: mode, status: "Active" } });`,
    ].join('\n');
    expect(auditSource('block.ts', source)).toEqual([]);
  });

  it('does not match species inside a nested filter as compliance', () => {
    // Regression guard: `where: { metadata: { contains: "species" } }`
    // must not falsely satisfy compliance. Top-level `species:` is the
    // contract; a nested predicate doesn't filter the result set by species.
    const source = `await prisma.animal.findMany({ where: { metadata: { contains: '"species":"cattle"' } } });`;
    expect(auditSource('nested.ts', source)).toHaveLength(1);
  });

  it('handles multi-line findMany calls by reading the full balanced-brace arg', () => {
    const source = [
      `await prisma.animal.findMany({`,
      `  where: { status: "Active" },`,
      `  orderBy: [{ category: "asc" }],`,
      `});`,
    ].join('\n');
    const offenders = auditSource('multi.ts', source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].line).toBe(1);
  });

  it('permits a multi-line findMany that has species deeper in the argument', () => {
    const source = [
      `await prisma.animal.findMany({`,
      `  where: {`,
      `    status: "Active",`,
      `    species: mode,`,
      `  },`,
      `});`,
    ].join('\n');
    expect(auditSource('multi-ok.ts', source)).toEqual([]);
  });

  it('flags each violation independently when multiple appear in one file', () => {
    const source = [
      `await prisma.animal.findMany({ where: { status: "Active" } });`,
      `await prisma.camp.findMany({ where: { species: mode } });`,
      `await prisma.mob.count({ where: { status: "Active" } });`,
    ].join('\n');
    const offenders = auditSource('multi-call.ts', source);
    expect(offenders).toHaveLength(2);
    expect(offenders.map((o) => o.line).sort()).toEqual([1, 3]);
  });

  it('treats activeSpeciesWhere(...) helper call as compliant species evidence', () => {
    // The Wave A2 helper returns `{ species, status: "Active" }`. Callers
    // that spread it satisfy the species axis by construction. The audit
    // must recognise the helper name so legitimate callers don't have to
    // duplicate the literal predicate.
    const source = `await prisma.animal.findMany({ where: activeSpeciesWhere(mode) });`;
    expect(auditSource('helper.ts', source)).toEqual([]);
  });
});

describe('offenderKey', () => {
  it('composes a stable `path::model::op::occurrenceIndex` for baseline diffing', () => {
    const o: Offender = {
      path: 'foo/bar.ts',
      line: 7,
      snippet: '…',
      modelName: 'animal',
      operation: 'findMany',
      occurrenceIndex: 0,
    };
    expect(offenderKey(o)).toBe('foo/bar.ts::animal::findMany::0');
  });
});

describe('fixture suite — end-to-end through the audit script', () => {
  it('flags the violating fixture but not the compliant one', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const fixturesDir = path.resolve(
      __dirname,
      '..',
      '..',
      '__tests__',
      'architecture',
      'audit-species-where-fixtures',
    );
    const violating = await fs.readFile(
      path.join(fixturesDir, 'unscoped-animal-findmany.fixture.ts'),
      'utf8',
    );
    const compliant = await fs.readFile(
      path.join(fixturesDir, 'scoped-animal-findmany.fixture.ts'),
      'utf8',
    );

    expect(
      auditSource('unscoped-animal-findmany.fixture.ts', violating).length,
    ).toBeGreaterThan(0);
    expect(
      auditSource('scoped-animal-findmany.fixture.ts', compliant),
    ).toEqual([]);
  });
});
