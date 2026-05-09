/**
 * Issue #178 — conditional soak gate.
 *
 * Tests the new `escalatedPathsTouched` flag on promoteToProd:
 *   - `false` → skip soak entirely (pure-transport fast path)
 *   - `true`  → enforce soak (escalated tier — `lib/migrator.ts` or
 *               `lib/ops/branch-clone.ts` touched)
 *   - undefined → back-compat (treat as `true` to keep unmigrated callers
 *                 on the old behaviour)
 *
 * Plus locks in the `diffTouchesEscalated` helper's contract: only the
 * narrow ESCALATED_PATHS set triggers the gate. Migrations, schema, and
 * app routes are NOT escalated (covered by structural backstops at
 * promote time per PRD #128).
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

describe('promoteToProd — conditional soak (#178)', () => {
  it('skips soak when escalatedPathsTouched=false (pure-transport)', async () => {
    // Soak elapsed = 5 min < 30 min floor — would normally throw SoakNotMetError.
    // With escalatedPathsTouched=false, the gate is bypassed entirely.
    const { promoteToProd } = await import('@/lib/ops/branch-clone');

    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/178-fast-path',
      tursoDbName: 'ft-clone-178-fast-abc001',
      createdAt: fiveMinsAgo,
    });

    const runProdMigration = vi.fn().mockResolvedValue({
      applied: ['0001_init.sql'],
      skipped: [],
    });

    const result = await promoteToProd({
      branchName: 'wave/178-fast-path',
      minSoakHours: 0.5,
      escalatedPathsTouched: false,
      metaClient: memClient,
      now: () => new Date(),
      runProdMigration,
      parityVerifyEnabled: false,
    });

    expect(result.branchName).toBe('wave/178-fast-path');
    // Migration should have been invoked (gate did NOT block).
    expect(runProdMigration).toHaveBeenCalledTimes(1);
    expect(result.prodMigrationAppliedFiles).toContain('0001_init.sql');
  });

  it('enforces soak when escalatedPathsTouched=true and soak unmet', async () => {
    // Soak elapsed = 5 min < 30 min floor — must throw.
    const { promoteToProd, SoakNotMetError } = await import('@/lib/ops/branch-clone');

    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/178-escalated',
      tursoDbName: 'ft-clone-178-esc-abc002',
      createdAt: fiveMinsAgo,
    });

    const runProdMigration = vi.fn().mockResolvedValue({ applied: [], skipped: [] });

    await expect(
      promoteToProd({
        branchName: 'wave/178-escalated',
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
    // undefined → treat as escalated → enforce soak.
    const { promoteToProd, SoakNotMetError } = await import('@/lib/ops/branch-clone');

    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/178-backcompat',
      tursoDbName: 'ft-clone-178-bc-abc003',
      createdAt: fiveMinsAgo,
    });

    const runProdMigration = vi.fn().mockResolvedValue({ applied: [], skipped: [] });

    await expect(
      promoteToProd({
        branchName: 'wave/178-backcompat',
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

  it('marks the meta row promoted when fast-path is taken', async () => {
    // Verifies the fast-path is a true skip (not an early return) — the
    // migration runs and the meta row is updated as for any successful promote.
    const { promoteToProd } = await import('@/lib/ops/branch-clone');
    const { getBranchClone } = await import('@/lib/meta-db');

    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/178-fast-marks',
      tursoDbName: 'ft-clone-178-mark-abc004',
      createdAt: oneMinAgo,
    });

    const fixedNow = new Date('2026-05-09T12:00:00.000Z');
    await promoteToProd({
      branchName: 'wave/178-fast-marks',
      minSoakHours: 0.5,
      escalatedPathsTouched: false,
      metaClient: memClient,
      now: () => fixedNow,
      runProdMigration: async () => ({ applied: [], skipped: [] }),
      parityVerifyEnabled: false,
    });

    const row = await getBranchClone('wave/178-fast-marks');
    expect(row!.prodMigrationAt).toBe('2026-05-09T12:00:00.000Z');
    expect(row!.lastPromotedAt).toBe('2026-05-09T12:00:00.000Z');
  });

  it('passes soak gate when escalatedPathsTouched=true and soak elapsed', async () => {
    // Soak elapsed = 1h > 30 min floor — must succeed.
    const { promoteToProd } = await import('@/lib/ops/branch-clone');

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/178-esc-soaked',
      tursoDbName: 'ft-clone-178-soaked-abc005',
      createdAt: oneHourAgo,
    });

    const runProdMigration = vi.fn().mockResolvedValue({
      applied: ['0010_add_thing.sql'],
      skipped: [],
    });

    const result = await promoteToProd({
      branchName: 'wave/178-esc-soaked',
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
