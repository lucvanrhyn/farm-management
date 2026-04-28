/**
 * Tests for lib/ops/branch-clone.ts
 *
 * Uses:
 * - A fake TursoCli that records calls and returns canned stdouts.
 * - __setMetaClientForTest() / __resetMetaClient() from Phase 1 so the
 *   cloner writes to an in-memory libSQL database, not a real Turso endpoint.
 * - `now` injection for deterministic timestamps.
 *
 * No actual `turso` binary or network calls are made.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import type { TursoCli } from '@/lib/ops/turso-cli';
import { TursoCliError } from '@/lib/ops/turso-cli';

// ── Environment stubs required by getMetaClient() ────────────────────────────
process.env.META_TURSO_URL = 'libsql://test.example';
process.env.META_TURSO_AUTH_TOKEN = 'token';

// ── In-memory DB helpers (mirrors meta-db-branch-clones.test.ts) ────────────
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
      prod_migration_at  TEXT
    )
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_branch_db_clones_created_at
      ON branch_db_clones(created_at)
  `);
  return client;
}

// ── Fake TursoCli factory ─────────────────────────────────────────────────────
interface FakeCall {
  args: readonly string[];
}

interface FakeCli extends TursoCli {
  calls: FakeCall[];
}

/**
 * Build a fake CLI where:
 * - responses maps arg[0]+arg[1] (e.g. 'db:create') → stdout string
 * - any unrecognised command returns '' by default
 * - if the value is an Error, it is thrown instead
 */
function makeFakeCli(
  responses: Record<string, string | Error> = {},
): FakeCli {
  const calls: FakeCall[] = [];
  return {
    calls,
    async run(args: readonly string[]): Promise<string> {
      calls.push({ args: [...args] });
      // Key is first two args joined with ':' e.g. 'db:create', 'db:show', 'db:tokens'
      const key = args.slice(0, 2).join(':');
      const response = responses[key];
      if (response instanceof Error) throw response;
      return response ?? '';
    },
  };
}

// Canned stdouts for the happy-path CLI sequence
const CANNED_URL = 'libsql://ft-clone-wave-19-option-c-a3f9b2.turso.io';
const CANNED_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.test-token';

function happyCli(): FakeCli {
  return makeFakeCli({
    'db:create': '',
    'db:show': CANNED_URL,
    'db:tokens': CANNED_TOKEN,
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

// ── Helper to get the subject under test (import after meta-db injection) ────
async function getCloneBranch() {
  // Re-import every time so module sees the injected meta client.
  const mod = await import('@/lib/ops/branch-clone');
  return mod.cloneBranch;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cloneBranch — happy path', () => {
  it('makes exactly 3 CLI calls in the correct order', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    expect(cli.calls).toHaveLength(3);
    expect(cli.calls[0].args[0]).toBe('db');
    expect(cli.calls[0].args[1]).toBe('create');
    expect(cli.calls[1].args[0]).toBe('db');
    expect(cli.calls[1].args[1]).toBe('show');
    expect(cli.calls[2].args[0]).toBe('db');
    expect(cli.calls[2].args[1]).toBe('tokens');
  });

  it('passes --from-db <sourceDbName> to db create', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    const createCall = cli.calls[0];
    const fromIdx = createCall.args.indexOf('--from-db');
    expect(fromIdx).toBeGreaterThan(-1);
    expect(createCall.args[fromIdx + 1]).toBe('acme-cattle');
  });

  it('passes --url flag to db show', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    const showCall = cli.calls[1];
    expect(showCall.args).toContain('--url');
  });

  it('returns populated CloneBranchResult with alreadyExisted=false', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    expect(result.branchName).toBe('wave/19-option-c');
    expect(result.tursoDbUrl).toBe(CANNED_URL);
    expect(result.tursoAuthToken).toBe(CANNED_TOKEN);
    expect(result.alreadyExisted).toBe(false);
    expect(typeof result.tursoDbName).toBe('string');
    expect(result.tursoDbName.length).toBeGreaterThan(0);
  });

  it('writes a row to meta-DB after successful clone', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();
    const { getBranchClone } = await import('@/lib/meta-db');

    await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    const row = await getBranchClone('wave/19-option-c');
    expect(row).not.toBeNull();
    expect(row!.tursoDbUrl).toBe(CANNED_URL);
    expect(row!.tursoAuthToken).toBe(CANNED_TOKEN);
    expect(row!.sourceDbName).toBe('acme-cattle');
  });

  it('uses custom cliPrefix when provided', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'feature/my-branch',
      sourceDbName: 'acme-cattle',
      cliPrefix: 'myprefix',
      cli,
      metaClient: memClient,
    });

    expect(result.tursoDbName).toMatch(/^myprefix-/);
  });

  it('defaults cliPrefix to "ft-clone" when not provided', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'feature/my-branch',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    expect(result.tursoDbName).toMatch(/^ft-clone-/);
  });
});

describe('cloneBranch — idempotency', () => {
  it('returns alreadyExisted=true when row exists in meta-DB', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    // First call creates the clone
    await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    // Second call with a fresh CLI to detect any extra calls
    const cli2 = happyCli();
    const result = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli: cli2,
      metaClient: memClient,
    });

    expect(result.alreadyExisted).toBe(true);
    expect(cli2.calls).toHaveLength(0); // NO CLI calls on second invocation
  });

  it('returns the stored URL and token from the existing row', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const first = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    const second = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli: makeFakeCli(),
      metaClient: memClient,
    });

    expect(second.tursoDbUrl).toBe(first.tursoDbUrl);
    expect(second.tursoAuthToken).toBe(first.tursoAuthToken);
    expect(second.tursoDbName).toBe(first.tursoDbName);
  });
});

describe('cloneBranch — mid-flight failure', () => {
  it('does NOT write to meta-DB when db show fails', async () => {
    const cli = makeFakeCli({
      'db:create': '',
      'db:show': new TursoCliError(['db', 'show', 'ft-clone-wave-x'], 1, 'not found'),
    });
    const cloneBranch = await getCloneBranch();
    const { getBranchClone } = await import('@/lib/meta-db');

    await expect(
      cloneBranch({
        branchName: 'wave/x-failing',
        sourceDbName: 'acme-cattle',
        cli,
        metaClient: memClient,
      }),
    ).rejects.toBeInstanceOf(TursoCliError);

    const row = await getBranchClone('wave/x-failing');
    expect(row).toBeNull();
  });

  it('does NOT write to meta-DB when db tokens fails', async () => {
    const cli = makeFakeCli({
      'db:create': '',
      'db:show': 'libsql://ft-clone-wave-x.turso.io',
      'db:tokens': new TursoCliError(['db', 'tokens', 'create', 'ft-clone-wave-x'], 1, 'auth error'),
    });
    const cloneBranch = await getCloneBranch();
    const { getBranchClone } = await import('@/lib/meta-db');

    await expect(
      cloneBranch({
        branchName: 'wave/x-token-fail',
        sourceDbName: 'acme-cattle',
        cli,
        metaClient: memClient,
      }),
    ).rejects.toBeInstanceOf(TursoCliError);

    const row = await getBranchClone('wave/x-token-fail');
    expect(row).toBeNull();
  });

  it('does NOT write to meta-DB when db create fails', async () => {
    const cli = makeFakeCli({
      'db:create': new TursoCliError(['db', 'create', 'ft-clone-wave-x'], 1, 'already exists'),
    });
    const cloneBranch = await getCloneBranch();
    const { getBranchClone } = await import('@/lib/meta-db');

    await expect(
      cloneBranch({
        branchName: 'wave/x-create-fail',
        sourceDbName: 'acme-cattle',
        cli,
        metaClient: memClient,
      }),
    ).rejects.toBeInstanceOf(TursoCliError);

    const row = await getBranchClone('wave/x-create-fail');
    expect(row).toBeNull();
  });
});

describe('cloneBranch — branch slug normalization', () => {
  it('produces a valid Turso DB name (lowercase, dashes, hash suffix)', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'wave/19-Option_C!!',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    // Must be lowercase
    expect(result.tursoDbName).toBe(result.tursoDbName.toLowerCase());
    // Must contain only alphanumeric and dashes
    expect(result.tursoDbName).toMatch(/^[a-z0-9-]+$/);
    // Must not start or end with a dash
    expect(result.tursoDbName).not.toMatch(/^-|-$/);
    // Must be within Turso's 64-char limit
    expect(result.tursoDbName.length).toBeLessThanOrEqual(64);
  });

  it('appends a 6-char hash derived from the branch name', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    // The DB name should end with a 6-char hex-ish hash segment
    const parts = result.tursoDbName.split('-');
    const hashPart = parts[parts.length - 1];
    expect(hashPart).toHaveLength(6);
    expect(hashPart).toMatch(/^[a-f0-9]{6}$/);
  });

  it('two different branches produce different DB names', async () => {
    const cli1 = happyCli();
    const cli2 = happyCli();
    const cloneBranch = await getCloneBranch();

    const r1 = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli: cli1,
      metaClient: memClient,
    });

    // Clear the DB so we can insert a second one without conflict
    await memClient.execute({ sql: `DELETE FROM branch_db_clones WHERE branch_name = ?`, args: ['wave/19-option-c'] });

    const r2 = await cloneBranch({
      branchName: 'wave/20-multi-species',
      sourceDbName: 'acme-cattle',
      cli: cli2,
      metaClient: memClient,
    });

    expect(r1.tursoDbName).not.toBe(r2.tursoDbName);
  });

  it('same branch always produces the same DB name (deterministic slug)', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    // We can't call cloneBranch twice for same branch without idempotency kicking in,
    // so we import slugifyBranchName directly to test determinism.
    const { slugifyBranchName } = await import('@/lib/ops/branch-clone');

    const slug1 = slugifyBranchName('wave/19-option-c', 'ft-clone');
    const slug2 = slugifyBranchName('wave/19-option-c', 'ft-clone');
    expect(slug1).toBe(slug2);

    // Also verify cliPrefix is incorporated
    const slugA = slugifyBranchName('wave/19-option-c', 'ft-clone');
    const slugB = slugifyBranchName('wave/19-option-c', 'myprefix');
    expect(slugA).not.toBe(slugB);

    void cli; // cli unused in this test
    void cloneBranch;
  });

  it('caps DB name at 64 characters for very long branch names', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const longBranchName = 'feature/' + 'a'.repeat(80);
    const result = await cloneBranch({
      branchName: longBranchName,
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    expect(result.tursoDbName.length).toBeLessThanOrEqual(64);
    // Should still end with the 6-char hash
    const parts = result.tursoDbName.split('-');
    const hashPart = parts[parts.length - 1];
    expect(hashPart).toHaveLength(6);
    expect(hashPart).toMatch(/^[a-f0-9]{6}$/);
  });

  it('handles branch name with consecutive special chars (collapses to single dash)', async () => {
    const { slugifyBranchName } = await import('@/lib/ops/branch-clone');

    const slug = slugifyBranchName('feat//double--slash!!problem', 'ft-clone');
    // No consecutive dashes in the slug portion (before hash)
    const withoutHash = slug.slice(0, slug.length - 7); // remove -XXXXXX
    expect(withoutHash).not.toMatch(/--/);
  });
});

describe('cloneBranch — deterministic timestamps via now injection', () => {
  it('records created_at matching the injected now() value', async () => {
    const fixedDate = new Date('2026-04-28T00:00:00.000Z');
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();
    const { getBranchClone } = await import('@/lib/meta-db');

    await cloneBranch({
      branchName: 'wave/deterministic',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
      now: () => fixedDate,
    });

    const row = await getBranchClone('wave/deterministic');
    expect(row!.createdAt).toBe('2026-04-28T00:00:00.000Z');
  });
});

describe('cloneBranch — CLI arg shapes', () => {
  it('passes the clone DB name as the 3rd arg to db create', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    // db create <clone-name> --from-db <sourceDbName>
    expect(cli.calls[0].args[2]).toBe(result.tursoDbName);
  });

  it('passes the clone DB name as the 3rd arg to db show', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    // db show <clone-name> --url
    expect(cli.calls[1].args[2]).toBe(result.tursoDbName);
  });

  it('passes the clone DB name as the 4th arg to db tokens create', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    // db tokens create <clone-name> --expiration none
    expect(cli.calls[2].args[2]).toBe('create');
    expect(cli.calls[2].args[3]).toBe(result.tursoDbName);
  });

  it('passes --expiration none to db tokens create', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'acme-cattle',
      cli,
      metaClient: memClient,
    });

    const tokenCall = cli.calls[2];
    const expIdx = tokenCall.args.indexOf('--expiration');
    expect(expIdx).toBeGreaterThan(-1);
    expect(tokenCall.args[expIdx + 1]).toBe('none');
  });
});

// ── Phase 3: destroyBranchDb ──────────────────────────────────────────────────

async function getDestroyBranchDb() {
  const mod = await import('@/lib/ops/branch-clone');
  return mod.destroyBranchDb;
}

async function getPromoteToProd() {
  const mod = await import('@/lib/ops/branch-clone');
  return mod.promoteToProd;
}

/** Insert a row directly into the in-memory client for test setup. */
async function insertCloneRow(
  client: Client,
  opts: {
    branchName: string;
    tursoDbName: string;
    createdAt: string;
  },
): Promise<void> {
  await client.execute({
    sql: `INSERT OR REPLACE INTO branch_db_clones
            (branch_name, turso_db_name, turso_db_url, turso_auth_token,
             source_db_name, created_at, last_promoted_at, prod_migration_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    args: [
      opts.branchName,
      opts.tursoDbName,
      'libsql://ft-test.turso.io',
      'tok-test',
      'acme-cattle',
      opts.createdAt,
    ],
  });
}

describe('destroyBranchDb — happy path', () => {
  it('calls turso db destroy once with --yes and deletes the meta row', async () => {
    const cli = makeFakeCli({ 'db:destroy': '' });
    const destroyBranchDb = await getDestroyBranchDb();

    await insertCloneRow(memClient, {
      branchName: 'wave/destroy-test',
      tursoDbName: 'ft-clone-destroy-test-abc123',
      createdAt: new Date().toISOString(),
    });

    const result = await destroyBranchDb({
      branchName: 'wave/destroy-test',
      cli,
      metaClient: memClient,
    });

    expect(result.branchName).toBe('wave/destroy-test');
    expect(result.tursoDestroyed).toBe(true);
    expect(result.metaRowDeleted).toBe(true);

    // exactly one CLI call: db destroy <tursoDbName> --yes
    expect(cli.calls).toHaveLength(1);
    expect(cli.calls[0].args[0]).toBe('db');
    expect(cli.calls[0].args[1]).toBe('destroy');
    expect(cli.calls[0].args[2]).toBe('ft-clone-destroy-test-abc123');
    expect(cli.calls[0].args).toContain('--yes');
  });

  it('meta row is gone from DB after successful destroy', async () => {
    const cli = makeFakeCli({ 'db:destroy': '' });
    const destroyBranchDb = await getDestroyBranchDb();
    const { getBranchClone } = await import('@/lib/meta-db');

    await insertCloneRow(memClient, {
      branchName: 'wave/gone-after',
      tursoDbName: 'ft-clone-gone-abc000',
      createdAt: new Date().toISOString(),
    });

    await destroyBranchDb({
      branchName: 'wave/gone-after',
      cli,
      metaClient: memClient,
    });

    const row = await getBranchClone('wave/gone-after');
    expect(row).toBeNull();
  });
});

describe('destroyBranchDb — idempotent on missing branch', () => {
  it('returns false/false and makes zero CLI calls when branch does not exist', async () => {
    const cli = makeFakeCli({});
    const destroyBranchDb = await getDestroyBranchDb();

    const result = await destroyBranchDb({
      branchName: 'wave/no-such-branch',
      cli,
      metaClient: memClient,
    });

    expect(result.branchName).toBe('wave/no-such-branch');
    expect(result.tursoDestroyed).toBe(false);
    expect(result.metaRowDeleted).toBe(false);
    expect(cli.calls).toHaveLength(0);
  });
});

describe('destroyBranchDb — turso failure preserves meta row', () => {
  it('does NOT delete the meta row when turso destroy fails, and bubbles the error', async () => {
    const cli = makeFakeCli({
      'db:destroy': new TursoCliError(['db', 'destroy', 'ft-clone-wave-x', '--yes'], 1, 'not found'),
    });
    const destroyBranchDb = await getDestroyBranchDb();
    const { getBranchClone } = await import('@/lib/meta-db');

    await insertCloneRow(memClient, {
      branchName: 'wave/turso-fail',
      tursoDbName: 'ft-clone-wave-x',
      createdAt: new Date().toISOString(),
    });

    await expect(
      destroyBranchDb({
        branchName: 'wave/turso-fail',
        cli,
        metaClient: memClient,
      }),
    ).rejects.toBeInstanceOf(TursoCliError);

    // Meta row must still be present so operator can retry
    const row = await getBranchClone('wave/turso-fail');
    expect(row).not.toBeNull();
  });
});

describe('destroyBranchDb — skipTursoDestroy flag', () => {
  it('skips the CLI call but still deletes the meta row when skipTursoDestroy=true', async () => {
    const cli = makeFakeCli({});
    const destroyBranchDb = await getDestroyBranchDb();
    const { getBranchClone } = await import('@/lib/meta-db');

    await insertCloneRow(memClient, {
      branchName: 'wave/orphan-row',
      tursoDbName: 'ft-clone-orphan-abc999',
      createdAt: new Date().toISOString(),
    });

    const result = await destroyBranchDb({
      branchName: 'wave/orphan-row',
      skipTursoDestroy: true,
      cli,
      metaClient: memClient,
    });

    expect(result.tursoDestroyed).toBe(false);
    expect(result.metaRowDeleted).toBe(true);
    expect(cli.calls).toHaveLength(0);

    const row = await getBranchClone('wave/orphan-row');
    expect(row).toBeNull();
  });
});

// ── Phase 3: promoteToProd ────────────────────────────────────────────────────

describe('promoteToProd — happy path', () => {
  it('runs migration, marks row promoted, and returns correct result', async () => {
    const promoteToProd = await getPromoteToProd();
    const { getBranchClone } = await import('@/lib/meta-db');

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/promote-happy',
      tursoDbName: 'ft-clone-promote-abc001',
      createdAt: twoHoursAgo,
    });

    const fakeNow = new Date('2026-04-29T12:00:00.000Z');
    const fakeMigration = async () => ({
      applied: ['0001_init.sql', '0002_add_camps.sql'],
      skipped: ['0000_bootstrap.sql'],
    });

    const result = await promoteToProd({
      branchName: 'wave/promote-happy',
      minSoakHours: 1,
      metaClient: memClient,
      now: () => fakeNow,
      runProdMigration: fakeMigration,
    });

    expect(result.branchName).toBe('wave/promote-happy');
    expect(result.prodMigrationAppliedFiles).toEqual(['0001_init.sql', '0002_add_camps.sql']);
    expect(result.prodMigrationSkippedFiles).toEqual(['0000_bootstrap.sql']);
    expect(result.promotedAt).toBe('2026-04-29T12:00:00.000Z');

    const row = await getBranchClone('wave/promote-happy');
    expect(row!.prodMigrationAt).toBe('2026-04-29T12:00:00.000Z');
  });
});

describe('promoteToProd — soak gate enforcement', () => {
  it('throws SoakNotMetError when clone is only 30 minutes old and minSoakHours=1', async () => {
    const { SoakNotMetError } = await import('@/lib/ops/branch-clone');
    const promoteToProd = await getPromoteToProd();

    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/soak-fail',
      tursoDbName: 'ft-clone-soak-abc002',
      createdAt: thirtyMinsAgo,
    });

    let migrationCalled = false;
    const fakeMigration = async () => {
      migrationCalled = true;
      return { applied: [], skipped: [] };
    };

    await expect(
      promoteToProd({
        branchName: 'wave/soak-fail',
        minSoakHours: 1,
        metaClient: memClient,
        now: () => new Date(),
        runProdMigration: fakeMigration,
      }),
    ).rejects.toBeInstanceOf(SoakNotMetError);

    expect(migrationCalled).toBe(false);
  });

  it('SoakNotMetError carries correct branchName and hour values', async () => {
    const { SoakNotMetError } = await import('@/lib/ops/branch-clone');
    const promoteToProd = await getPromoteToProd();

    const fixedCreatedAt = new Date('2026-04-29T10:00:00.000Z');
    const fixedNow = new Date('2026-04-29T10:30:00.000Z'); // only 0.5h elapsed
    await insertCloneRow(memClient, {
      branchName: 'wave/soak-error-fields',
      tursoDbName: 'ft-clone-soak-abc003',
      createdAt: fixedCreatedAt.toISOString(),
    });

    let caughtError: unknown;
    try {
      await promoteToProd({
        branchName: 'wave/soak-error-fields',
        minSoakHours: 2,
        metaClient: memClient,
        now: () => fixedNow,
        runProdMigration: async () => ({ applied: [], skipped: [] }),
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(SoakNotMetError);
    const soakErr = caughtError as InstanceType<typeof SoakNotMetError>;
    expect(soakErr.branchName).toBe('wave/soak-error-fields');
    expect(soakErr.minSoakHours).toBe(2);
    expect(soakErr.soakHoursElapsed).toBeCloseTo(0.5, 1);
  });

  it('meta row is NOT marked promoted when soak gate throws', async () => {
    const { SoakNotMetError } = await import('@/lib/ops/branch-clone');
    const promoteToProd = await getPromoteToProd();
    const { getBranchClone } = await import('@/lib/meta-db');

    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/soak-no-mark',
      tursoDbName: 'ft-clone-soak-abc004',
      createdAt: tenMinsAgo,
    });

    await expect(
      promoteToProd({
        branchName: 'wave/soak-no-mark',
        minSoakHours: 1,
        metaClient: memClient,
        now: () => new Date(),
        runProdMigration: async () => ({ applied: [], skipped: [] }),
      }),
    ).rejects.toBeInstanceOf(SoakNotMetError);

    const row = await getBranchClone('wave/soak-no-mark');
    expect(row!.lastPromotedAt).toBeNull();
    expect(row!.prodMigrationAt).toBeNull();
  });
});

describe('promoteToProd — forceSkipSoak', () => {
  it('runs migration when forceSkipSoak=true even if only 5 minutes old', async () => {
    const promoteToProd = await getPromoteToProd();

    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/force-skip',
      tursoDbName: 'ft-clone-force-abc005',
      createdAt: fiveMinsAgo,
    });

    let migrationCalled = false;
    const fakeMigration = async () => {
      migrationCalled = true;
      return { applied: ['0001_init.sql'], skipped: [] };
    };

    const result = await promoteToProd({
      branchName: 'wave/force-skip',
      minSoakHours: 1,
      forceSkipSoak: true,
      metaClient: memClient,
      now: () => new Date(),
      runProdMigration: fakeMigration,
    });

    expect(migrationCalled).toBe(true);
    expect(result.prodMigrationAppliedFiles).toEqual(['0001_init.sql']);
  });
});

describe('promoteToProd — branch not found', () => {
  it('throws BranchCloneNotFoundError when branch does not exist', async () => {
    const { BranchCloneNotFoundError } = await import('@/lib/ops/branch-clone');
    const promoteToProd = await getPromoteToProd();

    await expect(
      promoteToProd({
        branchName: 'wave/does-not-exist',
        metaClient: memClient,
        now: () => new Date(),
        runProdMigration: async () => ({ applied: [], skipped: [] }),
      }),
    ).rejects.toBeInstanceOf(BranchCloneNotFoundError);
  });
});

describe('promoteToProd — migration failure', () => {
  it('does NOT mark row promoted when runProdMigration throws', async () => {
    const promoteToProd = await getPromoteToProd();
    const { getBranchClone } = await import('@/lib/meta-db');

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/migration-fail',
      tursoDbName: 'ft-clone-migfail-abc006',
      createdAt: twoHoursAgo,
    });

    const migrationError = new Error('migration failed: column already exists');
    await expect(
      promoteToProd({
        branchName: 'wave/migration-fail',
        minSoakHours: 1,
        metaClient: memClient,
        now: () => new Date(),
        runProdMigration: async () => { throw migrationError; },
      }),
    ).rejects.toThrow('migration failed: column already exists');

    const row = await getBranchClone('wave/migration-fail');
    expect(row!.lastPromotedAt).toBeNull();
    expect(row!.prodMigrationAt).toBeNull();
  });
});

describe('promoteToProd — deterministic promotedAt via now injection', () => {
  it('records the injected now() value as promotedAt in both result and meta row', async () => {
    const promoteToProd = await getPromoteToProd();
    const { getBranchClone } = await import('@/lib/meta-db');

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await insertCloneRow(memClient, {
      branchName: 'wave/deterministic-promote',
      tursoDbName: 'ft-clone-det-abc007',
      createdAt: twoHoursAgo,
    });

    const fixedNow = new Date('2026-04-29T08:30:00.000Z');

    const result = await promoteToProd({
      branchName: 'wave/deterministic-promote',
      minSoakHours: 1,
      metaClient: memClient,
      now: () => fixedNow,
      runProdMigration: async () => ({ applied: [], skipped: [] }),
    });

    expect(result.promotedAt).toBe('2026-04-29T08:30:00.000Z');

    const row = await getBranchClone('wave/deterministic-promote');
    expect(row!.prodMigrationAt).toBe('2026-04-29T08:30:00.000Z');
  });
});
