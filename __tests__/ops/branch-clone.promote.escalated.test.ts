/**
 * Wave 179 — soak gate eliminated. Default `minSoakHours = 0`.
 *
 * Empirical record: 0 bugs caught across 60+ merges. The synchronous
 * backstops from PRD #128 (verifyMigrationApplied #141, parity audit
 * #137, no-select audit #140) plus the post-promote authenticated smoke
 * cover the entire known failure surface. The temporal soak window is
 * theatre — it sleeps a CI runner, not real traffic.
 *
 * Tests cover:
 *   - default behaviour (no minSoakHours arg) → soak no-op, promote
 *     succeeds even when "elapsed" is 0 min.
 *   - LEGACY revert path (`minSoakHours: 0.5`) — preserved for the
 *     one-line revert: `escalatedPathsTouched=false` skips, `=true`
 *     enforces, undefined treats as escalated.
 *   - `diffTouchesEscalated` helper — still exported for callers that
 *     opt into the legacy path.
 *
 * The metaClient stub pattern mirrors __tests__/lib/ops/branch-clone.test.ts.
 */
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';

// ── Environment stubs required by getMetaClient() ────────────────────────────
process.env.META_TURSO_URL = 'libsql://test.example';
process.env.META_TURSO_AUTH_TOKEN = 'token';

// ── In-memory DB helper (mirrors __tests__/lib/ops/branch-clone.test.ts) ────
async function createMemClient(): Promise<Client> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute(`
    CREATE TABLE IF NOT EXISTS branch_db_clones (
      branch_name        TEXT PRIMARY KEY,
      turso_db_name      TEXT NOT NULL,
      turso_db_url       TEXT NOT NULL,
      turso_auth_token   TEXT NOT NULL,
      source_db_name     TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      last_promoted_at   TEXT,
      prod_migration_at  TEXT,
      head_sha           TEXT,
      soak_started_at    TEXT
    )
  `);
  return client;
}

/** Insert a clone row directly into the in-memory client for setup. */
async function insertCloneRow(
  client: Client,
  opts: {
    branchName: string;
    tursoDbName: string;
    createdAt: string;
    headSha?: string | null;
    soakStartedAt?: string | null;
  },
): Promise<void> {
  await client.execute({
    sql: `INSERT OR REPLACE INTO branch_db_clones
            (branch_name, turso_db_name, turso_db_url, turso_auth_token,
             source_db_name, created_at, last_promoted_at, prod_migration_at,
             head_sha, soak_started_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    args: [
      opts.branchName,
      opts.tursoDbName,
      'libsql://ft-test.turso.io',
      'tok-test',
      'basson-boerdery',
      opts.createdAt,
      opts.headSha ?? null,
      opts.soakStartedAt ?? null,
    ],
  });
}

// ── Shared state ──────────────────────────────────────────────────────────────
let memClient: Client;

beforeEach(async () => {
  memClient = await createMemClient();
  const metaDb = await import('@/lib/meta-db');
  metaDb.__setMetaClientForTest(memClient);
});

afterEach(async () => {
  const metaDb = await import('@/lib/meta-db');
  metaDb.__resetMetaClient();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('diffTouchesEscalated', () => {
  it('returns true when lib/migrator.ts changed', async () => {
    const { diffTouchesEscalated } = await import('@/lib/ops/branch-clone');
    expect(diffTouchesEscalated(['lib/migrator.ts'])).toBe(true);
  });

  it('returns true when lib/ops/branch-clone.ts changed', async () => {
    const { diffTouchesEscalated } = await import('@/lib/ops/branch-clone');
    expect(diffTouchesEscalated(['lib/ops/branch-clone.ts'])).toBe(true);
  });

  it('returns false for migrations/ files (covered by verifyMigrationApplied #141)', async () => {
    const { diffTouchesEscalated } = await import('@/lib/ops/branch-clone');
    expect(diffTouchesEscalated(['migrations/0042_add_foo.sql'])).toBe(false);
  });

  it('returns false for prisma/schema.prisma (covered by checkPrismaColumnParity #137)', async () => {
    const { diffTouchesEscalated } = await import('@/lib/ops/branch-clone');
    expect(diffTouchesEscalated(['prisma/schema.prisma'])).toBe(false);
  });

  it('returns false for app routes', async () => {
    const { diffTouchesEscalated } = await import('@/lib/ops/branch-clone');
    expect(diffTouchesEscalated(['app/api/foo/route.ts'])).toBe(false);
  });

  it('returns true if ANY file in the changed set is escalated', async () => {
    const { diffTouchesEscalated } = await import('@/lib/ops/branch-clone');
    expect(
      diffTouchesEscalated(['app/api/foo/route.ts', 'lib/migrator.ts']),
    ).toBe(true);
  });

  it('returns false for empty diff', async () => {
    const { diffTouchesEscalated } = await import('@/lib/ops/branch-clone');
    expect(diffTouchesEscalated([])).toBe(false);
  });

  it('does not match files that contain but do not equal the escalated path', async () => {
    // Defensive: the regex is anchored. `lib/ops/branch-clone.test.ts` (this
    // very file's sibling) must not trigger the gate.
    const { diffTouchesEscalated } = await import('@/lib/ops/branch-clone');
    expect(diffTouchesEscalated(['lib/ops/branch-clone.test.ts'])).toBe(false);
    expect(diffTouchesEscalated(['some/lib/migrator.ts'])).toBe(false);
  });
});

describe('promoteToProd — default soak disabled (Wave 179)', () => {
  it('promotes immediately under default minSoakHours=0 even with 0 elapsed', async () => {
    // Default minSoakHours=0 (no arg passed) — soak gate is a no-op.
    // Even an "escalated" PR (lib/migrator.ts or lib/ops/branch-clone.ts
    // touched) under the default policy promotes without delay.
    const { promoteToProd } = await import('@/lib/ops/branch-clone');

    const justNow = new Date().toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/179-default-fast',
      tursoDbName: 'ft-clone-179-fast-abc101',
      createdAt: justNow,
    });

    const runProdMigration = vi.fn().mockResolvedValue({
      applied: ['0001_init.sql'],
      skipped: [],
    });

    const result = await promoteToProd({
      branchName: 'wave/179-default-fast',
      // No minSoakHours, no escalatedPathsTouched — both rely on defaults.
      metaClient: memClient,
      now: () => new Date(),
      runProdMigration,
      parityVerifyEnabled: false,
    });

    expect(result.branchName).toBe('wave/179-default-fast');
    expect(runProdMigration).toHaveBeenCalledTimes(1);
    expect(result.prodMigrationAppliedFiles).toContain('0001_init.sql');
  });

  it('promotes immediately under default even when escalatedPathsTouched=true', async () => {
    // Wave 179 flip: escalatedPathsTouched=true is now dormant under the
    // default minSoakHours=0. The gate logic still runs (isEscalated branch)
    // but elapsedHours >= 0 always passes the `< 0` check.
    const { promoteToProd } = await import('@/lib/ops/branch-clone');

    const justNow = new Date().toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/179-default-esc',
      tursoDbName: 'ft-clone-179-esc-abc102',
      createdAt: justNow,
    });

    const runProdMigration = vi.fn().mockResolvedValue({ applied: [], skipped: [] });

    const result = await promoteToProd({
      branchName: 'wave/179-default-esc',
      escalatedPathsTouched: true, // legacy escalation flag — dormant
      // minSoakHours omitted → default 0
      metaClient: memClient,
      now: () => new Date(),
      runProdMigration,
      parityVerifyEnabled: false,
    });

    expect(result.branchName).toBe('wave/179-default-esc');
    expect(runProdMigration).toHaveBeenCalledTimes(1);
  });

  it('marks the meta row promoted under default policy', async () => {
    // Verifies the default-fast-path is a true promote (not an early return) —
    // the migration runs and the meta row is updated as for any successful promote.
    const { promoteToProd } = await import('@/lib/ops/branch-clone');
    const { getBranchClone } = await import('@/lib/meta-db');

    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/179-default-marks',
      tursoDbName: 'ft-clone-179-mark-abc103',
      createdAt: oneMinAgo,
    });

    const fixedNow = new Date('2026-05-10T12:00:00.000Z');
    await promoteToProd({
      branchName: 'wave/179-default-marks',
      metaClient: memClient,
      now: () => fixedNow,
      runProdMigration: async () => ({ applied: [], skipped: [] }),
      parityVerifyEnabled: false,
    });

    const row = await getBranchClone('wave/179-default-marks');
    expect(row!.prodMigrationAt).toBe('2026-05-10T12:00:00.000Z');
    expect(row!.lastPromotedAt).toBe('2026-05-10T12:00:00.000Z');
  });
});

// ── LEGACY revert-path tests ──────────────────────────────────────────────────
// These tests exercise the soak-gate behaviour that activates when a future
// caller (or one-line revert) passes an explicit `minSoakHours > 0`. The
// bookkeeping infrastructure (escalatedPathsTouched parameter, soak_started_at,
// SHA-match) is retained for one-line revertability per Wave 179.

describe('promoteToProd — legacy soak path (minSoakHours: 0.5 — revert target)', () => {
  it('skips soak when escalatedPathsTouched=false (pure-transport)', async () => {
    // Soak elapsed = 5 min < 30 min floor — would normally throw SoakNotMetError.
    // With escalatedPathsTouched=false, the gate is bypassed entirely.
    const { promoteToProd } = await import('@/lib/ops/branch-clone');

    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/179-legacy-fast-path',
      tursoDbName: 'ft-clone-179-lfast-abc001',
      createdAt: fiveMinsAgo,
    });

    const runProdMigration = vi.fn().mockResolvedValue({
      applied: ['0001_init.sql'],
      skipped: [],
    });

    const result = await promoteToProd({
      branchName: 'wave/179-legacy-fast-path',
      minSoakHours: 0.5,
      escalatedPathsTouched: false,
      metaClient: memClient,
      now: () => new Date(),
      runProdMigration,
      parityVerifyEnabled: false,
    });

    expect(result.branchName).toBe('wave/179-legacy-fast-path');
    // Migration should have been invoked (gate did NOT block).
    expect(runProdMigration).toHaveBeenCalledTimes(1);
    expect(result.prodMigrationAppliedFiles).toContain('0001_init.sql');
  });

  it('enforces soak when escalatedPathsTouched=true and soak unmet', async () => {
    // Soak elapsed = 5 min < 30 min floor — must throw.
    const { promoteToProd, SoakNotMetError } = await import('@/lib/ops/branch-clone');

    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/179-legacy-escalated',
      tursoDbName: 'ft-clone-179-lesc-abc002',
      createdAt: fiveMinsAgo,
    });

    const runProdMigration = vi.fn().mockResolvedValue({ applied: [], skipped: [] });

    await expect(
      promoteToProd({
        branchName: 'wave/179-legacy-escalated',
        minSoakHours: 0.5,
        escalatedPathsTouched: true,
        metaClient: memClient,
        now: () => new Date(),
        runProdMigration,
        parityVerifyEnabled: false,
      }),
    ).rejects.toBeInstanceOf(SoakNotMetError);

    expect(runProdMigration).not.toHaveBeenCalled();
  });

  it('enforces soak when escalatedPathsTouched is undefined (back-compat)', async () => {
    // Old callers that have not been updated must keep the old behaviour:
    // undefined → treat as escalated → enforce soak (when caller opts into
    // a non-zero minSoakHours).
    const { promoteToProd, SoakNotMetError } = await import('@/lib/ops/branch-clone');

    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/179-legacy-backcompat',
      tursoDbName: 'ft-clone-179-lbc-abc003',
      createdAt: fiveMinsAgo,
    });

    const runProdMigration = vi.fn().mockResolvedValue({ applied: [], skipped: [] });

    await expect(
      promoteToProd({
        branchName: 'wave/179-legacy-backcompat',
        minSoakHours: 0.5,
        // escalatedPathsTouched intentionally omitted
        metaClient: memClient,
        now: () => new Date(),
        runProdMigration,
        parityVerifyEnabled: false,
      }),
    ).rejects.toBeInstanceOf(SoakNotMetError);

    expect(runProdMigration).not.toHaveBeenCalled();
  });

  it('passes soak gate when escalatedPathsTouched=true and soak elapsed', async () => {
    // Soak elapsed = 1h > 30 min floor — must succeed.
    const { promoteToProd } = await import('@/lib/ops/branch-clone');

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/179-legacy-esc-soaked',
      tursoDbName: 'ft-clone-179-lsoaked-abc005',
      createdAt: oneHourAgo,
    });

    const runProdMigration = vi.fn().mockResolvedValue({
      applied: ['0010_add_thing.sql'],
      skipped: [],
    });

    const result = await promoteToProd({
      branchName: 'wave/179-legacy-esc-soaked',
      minSoakHours: 0.5,
      escalatedPathsTouched: true,
      metaClient: memClient,
      now: () => new Date(),
      runProdMigration,
      parityVerifyEnabled: false,
    });

    expect(runProdMigration).toHaveBeenCalledTimes(1);
    expect(result.prodMigrationAppliedFiles).toContain('0010_add_thing.sql');
  });
});
