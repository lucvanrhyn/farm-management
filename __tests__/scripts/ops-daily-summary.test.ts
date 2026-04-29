// @vitest-environment node
/**
 * Tests for scripts/ops-daily-summary.ts — the daily ops summary script.
 *
 * All tests use the exported `runDailySummary(deps)` function with injected
 * fakes for listBranchClones, now, and log. No real meta-DB or network calls.
 *
 * Test plan:
 *   empty list
 *     1. Reports "Active branch clones: 0", exits 0
 *   single fresh clone
 *     2. Shows branch, age, no promoted marker, "fresh" status
 *     3. Reports "Stale clones (>7d): 0"
 *   stale clone detection
 *     4. Clone older than 168h → status is "STALE"
 *     5. Clone exactly 168h → still "fresh" (threshold is strictly >168h)
 *     6. Clone 168.1h → "STALE"
 *   promoted clone
 *     7. lastPromotedAt present → shows promotion date in output
 *     8. lastPromotedAt absent → shows dash in promoted column
 *   mixed fresh + stale
 *     9. Stale-count line appears with correct count
 *    10. Both branches appear in the output table
 *   return value
 *    11. Returns 0 for empty list
 *    12. Returns 0 for all-fresh list
 *    13. Returns 0 for mixed list (informational only, never non-zero)
 *   header / footer
 *    14. Outputs summary header with UTC timestamp
 *    15. Outputs "Active branch clones: N" line
 *    16. Outputs recommendation line when stale clones exist
 *    17. No recommendation line when no stale clones
 */

import { describe, it, expect } from 'vitest';
import { runDailySummary, type DailySummaryDeps } from '@/scripts/ops-daily-summary';
import type { BranchCloneRecord } from '@/lib/meta-db';

// ── Fake builders ─────────────────────────────────────────────────────────────

const BASE_NOW = new Date('2026-04-28T12:00:00.000Z');

function makeRecord(overrides: Partial<BranchCloneRecord> & { branchName: string }): BranchCloneRecord {
  return {
    branchName: overrides.branchName,
    tursoDbName: `ft-clone-${overrides.branchName.replace(/[^a-z0-9]/g, '-')}`,
    tursoDbUrl: `libsql://ft-clone-${overrides.branchName.replace(/[^a-z0-9]/g, '-')}.turso.io`,
    tursoAuthToken: 'tok-fake',
    sourceDbName: 'basson-boerdery',
    createdAt: overrides.createdAt ?? BASE_NOW.toISOString(),
    lastPromotedAt: overrides.lastPromotedAt ?? null,
    prodMigrationAt: overrides.prodMigrationAt ?? null,
  };
}

/** Age in hours from BASE_NOW. Positive n = n hours in the past. */
function createdAtHoursAgo(hours: number): string {
  return new Date(BASE_NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function captureLogs(deps: Partial<DailySummaryDeps>): { lines: string[] } & DailySummaryDeps {
  const lines: string[] = [];
  return {
    ...deps,
    log: (line: string) => { lines.push(line); },
    lines,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runDailySummary — empty list', () => {
  it('returns 0 and reports zero active clones', async () => {
    const cap = captureLogs({
      listBranchClonesImpl: async () => [],
      now: () => BASE_NOW,
    });

    const exitCode = await runDailySummary(cap);

    expect(exitCode).toBe(0);
    const output = cap.lines.join('\n');
    expect(output).toContain('Active branch clones: 0');
  });

  it('includes the UTC timestamp header', async () => {
    const cap = captureLogs({
      listBranchClonesImpl: async () => [],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('2026-04-28T12:00:00');
  });

  it('does NOT output the stale recommendation line when no clones exist', async () => {
    const cap = captureLogs({
      listBranchClonesImpl: async () => [],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).not.toContain('Recommend');
  });
});

describe('runDailySummary — single fresh clone', () => {
  it('shows branch name in output', async () => {
    const record = makeRecord({
      branchName: 'wave/19-option-c',
      createdAt: createdAtHoursAgo(3.2),
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('wave/19-option-c');
  });

  it('shows "fresh" status for clone under 168h old', async () => {
    const record = makeRecord({
      branchName: 'wave/19-option-c',
      createdAt: createdAtHoursAgo(3.2),
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('fresh');
  });

  it('reports "Stale clones (>7d): 0" when clone is fresh', async () => {
    const record = makeRecord({
      branchName: 'wave/19-option-c',
      createdAt: createdAtHoursAgo(24),
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('Stale clones (>7d): 0');
  });

  it('shows dash for unpromoted clone', async () => {
    const record = makeRecord({
      branchName: 'wave/22-layout',
      createdAt: createdAtHoursAgo(48),
      lastPromotedAt: null,
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    // The dash is the promoted-column placeholder
    expect(output).toContain('—');
  });

  it('returns 0', async () => {
    const record = makeRecord({
      branchName: 'wave/19-option-c',
      createdAt: createdAtHoursAgo(10),
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    const exitCode = await runDailySummary(cap);

    expect(exitCode).toBe(0);
  });
});

describe('runDailySummary — stale clone detection', () => {
  it('marks clone older than 168h as STALE', async () => {
    const record = makeRecord({
      branchName: 'feat-old-branch',
      createdAt: createdAtHoursAgo(172),
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('STALE');
  });

  it('marks clone exactly 168h as fresh (boundary: threshold is strictly >168h)', async () => {
    const record = makeRecord({
      branchName: 'exactly-168h-branch',
      createdAt: createdAtHoursAgo(168),
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('fresh');
    expect(output).not.toContain('STALE');
  });

  it('marks clone 168.1h old as STALE', async () => {
    const record = makeRecord({
      branchName: 'just-over-threshold',
      createdAt: createdAtHoursAgo(168.1),
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('STALE');
  });

  it('shows stale count in Stale clones line', async () => {
    const record = makeRecord({
      branchName: 'old-feature-branch',
      createdAt: createdAtHoursAgo(720),
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('Stale clones (>7d): 1');
  });

  it('outputs recommendation line when stale clones exist', async () => {
    const record = makeRecord({
      branchName: 'old-branch',
      createdAt: createdAtHoursAgo(200),
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('Recommend');
  });
});

describe('runDailySummary — promoted clone', () => {
  it('shows the promotion date when lastPromotedAt is set', async () => {
    const record = makeRecord({
      branchName: 'wave/24-tenant-isolation',
      createdAt: createdAtHoursAgo(172),
      lastPromotedAt: '2026-04-26T10:00:00.000Z',
    });
    const cap = captureLogs({
      listBranchClonesImpl: async () => [record],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('2026-04-26');
  });
});

describe('runDailySummary — mixed fresh + stale', () => {
  const freshRecord = makeRecord({
    branchName: 'wave/19-option-c',
    createdAt: createdAtHoursAgo(3.2),
  });
  const staleRecord1 = makeRecord({
    branchName: 'wave/24-tenant-isolation',
    createdAt: createdAtHoursAgo(172),
    lastPromotedAt: '2026-04-26T10:00:00.000Z',
  });
  const staleRecord2 = makeRecord({
    branchName: 'feat-diff-cutover-script',
    createdAt: createdAtHoursAgo(720),
  });

  it('both branches appear in output', async () => {
    const cap = captureLogs({
      listBranchClonesImpl: async () => [freshRecord, staleRecord1],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('wave/19-option-c');
    expect(output).toContain('wave/24-tenant-isolation');
  });

  it('stale-count line shows correct count of 2 stale clones', async () => {
    const cap = captureLogs({
      listBranchClonesImpl: async () => [freshRecord, staleRecord1, staleRecord2],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('Stale clones (>7d): 2');
  });

  it('shows both fresh and STALE statuses when mixed', async () => {
    const cap = captureLogs({
      listBranchClonesImpl: async () => [freshRecord, staleRecord1],
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('fresh');
    expect(output).toContain('STALE');
  });

  it('returns 0 for mixed list (informational — never fails)', async () => {
    const cap = captureLogs({
      listBranchClonesImpl: async () => [freshRecord, staleRecord1],
      now: () => BASE_NOW,
    });

    const exitCode = await runDailySummary(cap);

    expect(exitCode).toBe(0);
  });
});

describe('runDailySummary — active clone count', () => {
  it('reports "Active branch clones: 4" for 4 records', async () => {
    const records = [
      makeRecord({ branchName: 'wave/a', createdAt: createdAtHoursAgo(1) }),
      makeRecord({ branchName: 'wave/b', createdAt: createdAtHoursAgo(48) }),
      makeRecord({ branchName: 'wave/c', createdAt: createdAtHoursAgo(100) }),
      makeRecord({ branchName: 'wave/d', createdAt: createdAtHoursAgo(200) }),
    ];
    const cap = captureLogs({
      listBranchClonesImpl: async () => records,
      now: () => BASE_NOW,
    });

    await runDailySummary(cap);

    const output = cap.lines.join('\n');
    expect(output).toContain('Active branch clones: 4');
  });
});
