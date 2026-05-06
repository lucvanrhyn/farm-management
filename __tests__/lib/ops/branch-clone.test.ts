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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
      prod_migration_at  TEXT,
      head_sha           TEXT,
      soak_started_at    TEXT
    )
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_branch_db_clones_created_at
      ON branch_db_clones(created_at)
  `);
  // farms table is required for runProdMigrationsAllTenants tests, which call
  // getAllFarmSlugs() / getFarmCreds() against the same in-memory client.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS farms (
      id                  TEXT PRIMARY KEY,
      slug                TEXT NOT NULL UNIQUE,
      display_name        TEXT NOT NULL,
      turso_url           TEXT NOT NULL,
      turso_auth_token    TEXT NOT NULL,
      tier                TEXT NOT NULL DEFAULT 'basic',
      created_at          TEXT NOT NULL
    )
  `);
  return client;
}

/** Insert a farm row into the in-memory meta-DB for tenant-enumeration tests. */
async function insertFarmRow(
  client: Client,
  opts: { slug: string; tursoUrl?: string; tursoAuthToken?: string },
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO farms (id, slug, display_name, turso_url, turso_auth_token, tier, created_at)
          VALUES (?, ?, ?, ?, ?, 'basic', ?)`,
    args: [
      `id-${opts.slug}`,
      opts.slug,
      opts.slug,
      opts.tursoUrl ?? `libsql://${opts.slug}.turso.io`,
      opts.tursoAuthToken ?? `tok-${opts.slug}`,
      new Date().toISOString(),
    ],
  });
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
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
      cli,
      metaClient: memClient,
    });

    const createCall = cli.calls[0];
    const fromIdx = createCall.args.indexOf('--from-db');
    expect(fromIdx).toBeGreaterThan(-1);
    expect(createCall.args[fromIdx + 1]).toBe('basson-boerdery');
  });

  it('passes --url flag to db show', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
      cli,
      metaClient: memClient,
    });

    const row = await getBranchClone('wave/19-option-c');
    expect(row).not.toBeNull();
    expect(row!.tursoDbUrl).toBe(CANNED_URL);
    expect(row!.tursoAuthToken).toBe(CANNED_TOKEN);
    expect(row!.sourceDbName).toBe('basson-boerdery');
  });

  it('uses custom cliPrefix when provided', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'feature/my-branch',
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
      cli,
      metaClient: memClient,
    });

    // Second call with a fresh CLI to detect any extra calls
    const cli2 = happyCli();
    const result = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
      cli,
      metaClient: memClient,
    });

    const second = await cloneBranch({
      branchName: 'wave/19-option-c',
      sourceDbName: 'basson-boerdery',
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
        sourceDbName: 'basson-boerdery',
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
        sourceDbName: 'basson-boerdery',
        cli,
        metaClient: memClient,
      }),
    ).rejects.toBeInstanceOf(TursoCliError);

    const row = await getBranchClone('wave/x-token-fail');
    expect(row).toBeNull();
  });

  it('does NOT write to meta-DB when db create fails with a non-orphan error', async () => {
    // "already exists" is now the orphan-adoption signal (see orphan-adoption
    // suite below). Use a different error stderr to exercise the genuine-
    // failure path, where the function must still throw and leave meta-DB
    // untouched.
    const cli = makeFakeCli({
      'db:create': new TursoCliError(['db', 'create', 'ft-clone-wave-x'], 1, 'permission denied'),
    });
    const cloneBranch = await getCloneBranch();
    const { getBranchClone } = await import('@/lib/meta-db');

    await expect(
      cloneBranch({
        branchName: 'wave/x-create-fail',
        sourceDbName: 'basson-boerdery',
        cli,
        metaClient: memClient,
      }),
    ).rejects.toBeInstanceOf(TursoCliError);

    const row = await getBranchClone('wave/x-create-fail');
    expect(row).toBeNull();
  });
});

describe('cloneBranch — orphan clone adoption', () => {
  // Bug pattern: a prior gate run successfully created the Turso DB but
  // failed before persisting the meta-DB record (e.g. `db show` or `db tokens`
  // throwing). The orphan Turso DB then blocks every subsequent gate run on
  // the same branch — `db create` returns "already exists", and without
  // adoption logic the gate workflow can never recover without manual
  // operator cleanup. This suite locks in the self-healing behavior.

  it('adopts the orphan clone when db create returns "already exists"', async () => {
    const cli = makeFakeCli({
      'db:create': new TursoCliError(
        ['db', 'create', 'ft-clone-wave-x'],
        1,
        'could not create database ft-clone-wave-x: database with name ft-clone-wave-x already exists',
      ),
      'db:show': CANNED_URL,
      'db:tokens': CANNED_TOKEN,
    });
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'wave/x-orphaned',
      sourceDbName: 'basson-boerdery',
      cli,
      metaClient: memClient,
    });

    expect(result.alreadyExisted).toBe(true);
    expect(result.tursoDbUrl).toBe(CANNED_URL);
    expect(result.tursoAuthToken).toBe(CANNED_TOKEN);
  });

  it('writes a meta-DB row when adopting an orphan clone', async () => {
    const cli = makeFakeCli({
      'db:create': new TursoCliError(
        ['db', 'create', 'ft-clone-wave-x'],
        1,
        'database with name ft-clone-wave-x already exists',
      ),
      'db:show': CANNED_URL,
      'db:tokens': CANNED_TOKEN,
    });
    const cloneBranch = await getCloneBranch();
    const { getBranchClone } = await import('@/lib/meta-db');

    await cloneBranch({
      branchName: 'wave/x-orphan-persist',
      sourceDbName: 'basson-boerdery',
      cli,
      metaClient: memClient,
    });

    const row = await getBranchClone('wave/x-orphan-persist');
    expect(row).not.toBeNull();
    expect(row!.tursoDbUrl).toBe(CANNED_URL);
    expect(row!.tursoAuthToken).toBe(CANNED_TOKEN);
    expect(row!.sourceDbName).toBe('basson-boerdery');
  });

  it('still calls db show + db tokens after adopting (3 CLI calls total)', async () => {
    const cli = makeFakeCli({
      'db:create': new TursoCliError(
        ['db', 'create', 'ft-clone-wave-x'],
        1,
        'already exists',
      ),
      'db:show': CANNED_URL,
      'db:tokens': CANNED_TOKEN,
    });
    const cloneBranch = await getCloneBranch();

    await cloneBranch({
      branchName: 'wave/x-orphan-calls',
      sourceDbName: 'basson-boerdery',
      cli,
      metaClient: memClient,
    });

    expect(cli.calls).toHaveLength(3);
    expect(cli.calls[0].args.slice(0, 2)).toEqual(['db', 'create']);
    expect(cli.calls[1].args.slice(0, 2)).toEqual(['db', 'show']);
    expect(cli.calls[2].args.slice(0, 2)).toEqual(['db', 'tokens']);
  });

  it('matches the "already exists" signal case-insensitively', async () => {
    // Defensive: turso CLI casing varies across versions ("Already Exists",
    // "ALREADY EXISTS", etc). The detector must not be brittle.
    const cli = makeFakeCli({
      'db:create': new TursoCliError(
        ['db', 'create', 'ft-clone-wave-x'],
        1,
        'database ALREADY EXISTS',
      ),
      'db:show': CANNED_URL,
      'db:tokens': CANNED_TOKEN,
    });
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'wave/x-orphan-case',
      sourceDbName: 'basson-boerdery',
      cli,
      metaClient: memClient,
    });

    expect(result.alreadyExisted).toBe(true);
  });
});

describe('cloneBranch — branch slug normalization', () => {
  it('produces a valid Turso DB name (lowercase, dashes, hash suffix)', async () => {
    const cli = happyCli();
    const cloneBranch = await getCloneBranch();

    const result = await cloneBranch({
      branchName: 'wave/19-Option_C!!',
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
      cli: cli1,
      metaClient: memClient,
    });

    // Clear the DB so we can insert a second one without conflict
    await memClient.execute({ sql: `DELETE FROM branch_db_clones WHERE branch_name = ?`, args: ['wave/19-option-c'] });

    const r2 = await cloneBranch({
      branchName: 'wave/20-multi-species',
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
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
      sourceDbName: 'basson-boerdery',
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
  // PRD #128: existing tests don't exercise the parity verifier (they pre-date
  // it). Default `parityVerifyEnabled: false` here so the historical happy/sad
  // paths still pass; new parity-specific tests live in their own describe
  // block and explicitly enable it. Callers can override the option to opt
  // back in.
  return (input: Parameters<typeof mod.promoteToProd>[0]) =>
    mod.promoteToProd({ parityVerifyEnabled: false, ...input });
}

/** Insert a row directly into the in-memory client for test setup. */
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

    const twoHoursAgo = '2026-04-29T06:30:00.000Z'; // 2h before fixedNow
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

    const twoHoursAgo = '2026-04-29T06:30:00.000Z'; // 2h before fixedNow
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

    const twoHoursAgo = '2026-04-29T06:30:00.000Z'; // 2h before fixedNow
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

// ── Wave 4 A1: all-tenant promote (Codex CRITICAL) ────────────────────────────
//
// The previous default `_defaultRunProdMigration` only ran migrations against
// the single DB pointed to by PROD_TENANT_DB_URL. That meant every tenant
// added beyond Basson Boerdery would silently miss schema changes at promote
// time. The new `runProdMigrationsAllTenants` helper enumerates farms via the
// meta-DB and runs migrations against each.
//
// These tests inject `runForTenant` so the actual libSQL connection + migration
// loader stay out of the test surface — the contract under test is purely:
// "for every farm slug returned by the meta-DB, run for that tenant; aggregate
// applied/skipped with slug prefixes; throw if ANY tenant fails".

async function getRunProdMigrationsAllTenants() {
  const mod = await import('@/lib/ops/branch-clone');
  return mod.runProdMigrationsAllTenants;
}

describe('runProdMigrationsAllTenants — multi-tenant enumeration (Wave 4 A1)', () => {
  it('runs migrations against ≥2 tenants when meta-DB has multiple farms', async () => {
    await insertFarmRow(memClient, { slug: 'basson-boerdery' });
    await insertFarmRow(memClient, { slug: 'tenant-two' });
    await insertFarmRow(memClient, { slug: 'tenant-three' });

    const runForTenant = vi.fn(async (slug: string) => ({
      applied: [`${slug}-0001.sql`],
      skipped: [],
    }));

    const runProdMigrationsAllTenants = await getRunProdMigrationsAllTenants();
    const result = await runProdMigrationsAllTenants({
      metaClient: memClient,
      runForTenant,
    });

    // Critical assertion: every enumerated tenant got a runForTenant call.
    expect(runForTenant).toHaveBeenCalledTimes(3);
    const calledSlugs = runForTenant.mock.calls.map((c) => c[0]).sort();
    expect(calledSlugs).toEqual(['basson-boerdery', 'tenant-three', 'tenant-two']);

    // Each tenant's applied list contributes to the aggregate, prefixed by slug.
    expect(result.applied).toContain('basson-boerdery:basson-boerdery-0001.sql');
    expect(result.applied).toContain('tenant-two:tenant-two-0001.sql');
    expect(result.applied).toContain('tenant-three:tenant-three-0001.sql');
  });

  it('passes the meta-DB creds for each slug into runForTenant', async () => {
    await insertFarmRow(memClient, {
      slug: 'farm-a',
      tursoUrl: 'libsql://farm-a.example',
      tursoAuthToken: 'tok-a',
    });
    await insertFarmRow(memClient, {
      slug: 'farm-b',
      tursoUrl: 'libsql://farm-b.example',
      tursoAuthToken: 'tok-b',
    });

    const runForTenant = vi.fn(
      async (_slug: string, _creds: { tursoUrl: string; tursoAuthToken: string; tier: string }) => ({
        applied: [] as string[],
        skipped: [] as string[],
      }),
    );
    const runProdMigrationsAllTenants = await getRunProdMigrationsAllTenants();
    await runProdMigrationsAllTenants({
      metaClient: memClient,
      runForTenant,
    });

    const callsBySlug = new Map(
      runForTenant.mock.calls.map((c) => [c[0], c[1]]),
    );
    expect(callsBySlug.get('farm-a')).toMatchObject({
      tursoUrl: 'libsql://farm-a.example',
      tursoAuthToken: 'tok-a',
    });
    expect(callsBySlug.get('farm-b')).toMatchObject({
      tursoUrl: 'libsql://farm-b.example',
      tursoAuthToken: 'tok-b',
    });
  });

  it('throws an aggregate error if ANY tenant migration fails (no silent partial success)', async () => {
    await insertFarmRow(memClient, { slug: 'farm-good' });
    await insertFarmRow(memClient, { slug: 'farm-bad' });
    await insertFarmRow(memClient, { slug: 'farm-also-good' });

    const runForTenant = vi.fn(async (slug: string) => {
      if (slug === 'farm-bad') {
        throw new Error('boom: column already exists');
      }
      return { applied: [`${slug}-0001.sql`], skipped: [] };
    });

    const runProdMigrationsAllTenants = await getRunProdMigrationsAllTenants();
    await expect(
      runProdMigrationsAllTenants({
        metaClient: memClient,
        runForTenant,
      }),
    ).rejects.toThrow(/farm-bad/);

    // All tenants should have been attempted before the throw, so the operator
    // sees the full damage report rather than aborting on the first failure.
    expect(runForTenant).toHaveBeenCalledTimes(3);
  });

  it('skips slugs whose getFarmCreds returns null (orphan slug) without throwing', async () => {
    // Insert a "real" farm and a row with empty creds that getFarmCreds will
    // still return — so we simulate orphan via a slug whose row was deleted.
    await insertFarmRow(memClient, { slug: 'farm-real' });
    // Insert a farm row, then delete it AFTER getAllFarmSlugs sees it. We
    // emulate this by stubbing getFarmCreds via an injected lookup.
    const runForTenant = vi.fn(async (slug: string) => ({
      applied: [`${slug}-0001.sql`],
      skipped: [],
    }));
    const getCredsForSlug = vi.fn(async (slug: string) => {
      if (slug === 'farm-real') {
        return { tursoUrl: 'libsql://farm-real.example', tursoAuthToken: 'tok-r', tier: 'basic' };
      }
      return null; // orphan
    });

    // Add a second slug whose creds will resolve to null via injected lookup.
    await memClient.execute({
      sql: `INSERT INTO farms (id, slug, display_name, turso_url, turso_auth_token, tier, created_at)
            VALUES (?, ?, ?, ?, ?, 'basic', ?)`,
      args: ['id-orphan', 'farm-orphan', 'farm-orphan', '', '', new Date().toISOString()],
    });

    const runProdMigrationsAllTenants = await getRunProdMigrationsAllTenants();
    const result = await runProdMigrationsAllTenants({
      metaClient: memClient,
      runForTenant,
      getCredsForSlug,
    });

    // Orphan slug should be skipped — runForTenant only called for the real one.
    expect(runForTenant).toHaveBeenCalledTimes(1);
    expect(runForTenant.mock.calls[0][0]).toBe('farm-real');
    expect(result.applied).toContain('farm-real:farm-real-0001.sql');
  });

  it('returns empty applied/skipped when meta-DB has zero farms', async () => {
    const runForTenant = vi.fn(async () => ({ applied: [], skipped: [] }));
    const runProdMigrationsAllTenants = await getRunProdMigrationsAllTenants();

    const result = await runProdMigrationsAllTenants({
      metaClient: memClient,
      runForTenant,
    });

    expect(runForTenant).not.toHaveBeenCalled();
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('aggregates skipped lists with slug prefix across tenants', async () => {
    await insertFarmRow(memClient, { slug: 'farm-1' });
    await insertFarmRow(memClient, { slug: 'farm-2' });

    const runForTenant = vi.fn(async (slug: string) => ({
      applied: [],
      skipped: [`0001_init.sql`, `0002_add_${slug}.sql`],
    }));

    const runProdMigrationsAllTenants = await getRunProdMigrationsAllTenants();
    const result = await runProdMigrationsAllTenants({
      metaClient: memClient,
      runForTenant,
    });

    expect(result.skipped).toContain('farm-1:0001_init.sql');
    expect(result.skipped).toContain('farm-1:0002_add_farm-1.sql');
    expect(result.skipped).toContain('farm-2:0001_init.sql');
    expect(result.skipped).toContain('farm-2:0002_add_farm-2.sql');
  });
});

describe('promoteToProd integrates with all-tenant runner (Wave 4 A1)', () => {
  it('promote uses runProdMigrationsAllTenants by default and migrates ≥2 tenants', async () => {
    await insertFarmRow(memClient, { slug: 'tenant-alpha' });
    await insertFarmRow(memClient, { slug: 'tenant-beta' });

    const twoHoursAgo = '2026-04-29T06:30:00.000Z';
    await insertCloneRow(memClient, {
      branchName: 'wave/multi-tenant-promote',
      tursoDbName: 'ft-clone-multi-abc100',
      createdAt: twoHoursAgo,
    });

    const runForTenant = vi.fn(async (slug: string) => ({
      applied: [`${slug}-0001.sql`],
      skipped: [],
    }));

    // Build the default runner with the test injectables and pass it as
    // runProdMigration to promoteToProd, which is what the production wiring
    // does under the hood (the workflow calls promoteToProd with no override
    // and the default delegates to runProdMigrationsAllTenants).
    const { runProdMigrationsAllTenants } = await import('@/lib/ops/branch-clone');
    const promoteToProd = await getPromoteToProd();

    const result = await promoteToProd({
      branchName: 'wave/multi-tenant-promote',
      minSoakHours: 1,
      metaClient: memClient,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      runProdMigration: () =>
        runProdMigrationsAllTenants({ metaClient: memClient, runForTenant }),
    });

    expect(runForTenant).toHaveBeenCalledTimes(2);
    expect(result.prodMigrationAppliedFiles).toContain('tenant-alpha:tenant-alpha-0001.sql');
    expect(result.prodMigrationAppliedFiles).toContain('tenant-beta:tenant-beta-0001.sql');
  });
});

// ── Issue #101: Commit-SHA soak gate ─────────────────────────────────────────
//
// Bug: promoteToProd measured soak from `created_at` (branch clone creation
// time). A force-push or re-push to a long-lived branch left `created_at`
// unchanged, so a brand-new commit would pass the gate immediately.
//
// Fix: add `head_sha` + `soak_started_at` to `branch_db_clones`. A new helper
// `recordCiPassForCommit` stamps these fields when CI finishes for a given SHA.
// `promoteToProd` now receives the PR head SHA and:
//   1. If `head_sha` in the row doesn't match, throws SoakNotMetError
//      (telemetry counter: 'soak_sha_mismatch').
//   2. Measures elapsed from `soak_started_at` (not `created_at`).
//
// RED tests (these must FAIL before implementation):

async function getRecordCiPassForCommit() {
  const mod = await import('@/lib/ops/branch-clone');
  return mod.recordCiPassForCommit;
}

describe('recordCiPassForCommit — stamps head_sha + soak_started_at', () => {
  it('sets head_sha and soak_started_at on an existing clone row', async () => {
    const recordCiPassForCommit = await getRecordCiPassForCommit();

    await insertCloneRow(memClient, {
      branchName: 'wave/ci-pass-test',
      tursoDbName: 'ft-clone-ci-pass-abc111',
      createdAt: new Date('2026-05-01T10:00:00.000Z').toISOString(),
    });

    const fixedNow = new Date('2026-05-01T11:00:00.000Z');
    await recordCiPassForCommit({
      branchName: 'wave/ci-pass-test',
      commitSha: 'abc123def456',
      metaClient: memClient,
      now: () => fixedNow,
    });

    const result = await memClient.execute({
      sql: `SELECT head_sha, soak_started_at FROM branch_db_clones WHERE branch_name = ?`,
      args: ['wave/ci-pass-test'],
    });
    expect(result.rows[0].head_sha).toBe('abc123def456');
    expect(result.rows[0].soak_started_at).toBe('2026-05-01T11:00:00.000Z');
  });

  it('overwrites an existing head_sha when CI passes again for a new commit', async () => {
    const recordCiPassForCommit = await getRecordCiPassForCommit();

    await insertCloneRow(memClient, {
      branchName: 'wave/ci-overwrite',
      tursoDbName: 'ft-clone-overwrite-abc112',
      createdAt: new Date().toISOString(),
      headSha: 'old-sha-999',
      soakStartedAt: new Date('2026-05-01T08:00:00.000Z').toISOString(),
    });

    const newNow = new Date('2026-05-02T09:00:00.000Z');
    await recordCiPassForCommit({
      branchName: 'wave/ci-overwrite',
      commitSha: 'new-sha-888',
      metaClient: memClient,
      now: () => newNow,
    });

    const result = await memClient.execute({
      sql: `SELECT head_sha, soak_started_at FROM branch_db_clones WHERE branch_name = ?`,
      args: ['wave/ci-overwrite'],
    });
    expect(result.rows[0].head_sha).toBe('new-sha-888');
    expect(result.rows[0].soak_started_at).toBe('2026-05-02T09:00:00.000Z');
  });
});

describe('promoteToProd — commit-SHA soak gate (issue #101)', () => {
  it('throws SoakNotMetError when branch was created 2h ago but commit was pushed 5min ago', async () => {
    // This is the core regression test for issue #101:
    // The branch clone exists (created 2h ago), so the OLD gate would pass.
    // But CI only finished for this SHA 5 minutes ago — the NEW gate must reject.
    const { SoakNotMetError } = await import('@/lib/ops/branch-clone');
    const promoteToProd = await getPromoteToProd();
    const recordCiPassForCommit = await getRecordCiPassForCommit();

    const twoHoursAgo = new Date('2026-05-01T10:00:00.000Z');
    const fiveMinutesAgo = new Date('2026-05-01T11:55:00.000Z');
    const nowTime = new Date('2026-05-01T12:00:00.000Z');

    // Branch clone created 2h ago (old gate would pass minSoakHours=1)
    await insertCloneRow(memClient, {
      branchName: 'wave/101-regression',
      tursoDbName: 'ft-clone-101-abc200',
      createdAt: twoHoursAgo.toISOString(),
    });

    // CI just passed for a brand-new commit 5min ago
    await recordCiPassForCommit({
      branchName: 'wave/101-regression',
      commitSha: 'fresh-sha-001',
      metaClient: memClient,
      now: () => fiveMinutesAgo,
    });

    let migrationCalled = false;
    await expect(
      promoteToProd({
        branchName: 'wave/101-regression',
        headSha: 'fresh-sha-001',
        minSoakHours: 1,
        metaClient: memClient,
        now: () => nowTime,
        runProdMigration: async () => {
          migrationCalled = true;
          return { applied: [], skipped: [] };
        },
      }),
    ).rejects.toBeInstanceOf(SoakNotMetError);

    expect(migrationCalled).toBe(false);
  });

  it('passes soak gate when headSha CI finished 2h ago', async () => {
    const promoteToProd = await getPromoteToProd();
    const recordCiPassForCommit = await getRecordCiPassForCommit();

    const twoHoursAgo = new Date('2026-05-01T10:00:00.000Z');
    const nowTime = new Date('2026-05-01T12:00:00.000Z');

    await insertCloneRow(memClient, {
      branchName: 'wave/101-pass',
      tursoDbName: 'ft-clone-101-abc201',
      createdAt: twoHoursAgo.toISOString(),
    });

    // CI passed for this SHA 2h ago
    await recordCiPassForCommit({
      branchName: 'wave/101-pass',
      commitSha: 'soaked-sha-002',
      metaClient: memClient,
      now: () => twoHoursAgo,
    });

    const result = await promoteToProd({
      branchName: 'wave/101-pass',
      headSha: 'soaked-sha-002',
      minSoakHours: 1,
      metaClient: memClient,
      now: () => nowTime,
      runProdMigration: async () => ({ applied: ['0013_payfast.sql'], skipped: [] }),
    });

    expect(result.branchName).toBe('wave/101-pass');
    expect(result.prodMigrationAppliedFiles).toContain('0013_payfast.sql');
  });

  it('throws SoakNotMetError with shaMismatch=true when headSha does not match stored sha', async () => {
    // A branch that has soaked for 2h but a DIFFERENT sha than what is being promoted
    const { SoakNotMetError } = await import('@/lib/ops/branch-clone');
    const promoteToProd = await getPromoteToProd();
    const recordCiPassForCommit = await getRecordCiPassForCommit();

    const twoHoursAgo = new Date('2026-05-01T10:00:00.000Z');
    const nowTime = new Date('2026-05-01T12:00:00.000Z');

    await insertCloneRow(memClient, {
      branchName: 'wave/101-mismatch',
      tursoDbName: 'ft-clone-101-abc202',
      createdAt: twoHoursAgo.toISOString(),
    });

    // Old commit soaked for 2h
    await recordCiPassForCommit({
      branchName: 'wave/101-mismatch',
      commitSha: 'old-soaked-sha',
      metaClient: memClient,
      now: () => twoHoursAgo,
    });

    // But now we're trying to promote a DIFFERENT sha that was just pushed
    let caughtError: unknown;
    try {
      await promoteToProd({
        branchName: 'wave/101-mismatch',
        headSha: 'new-unsoaked-sha',
        minSoakHours: 1,
        metaClient: memClient,
        now: () => nowTime,
        runProdMigration: async () => ({ applied: [], skipped: [] }),
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(SoakNotMetError);
    const soakErr = caughtError as InstanceType<typeof SoakNotMetError>;
    expect(soakErr.shaMismatch).toBe(true);
    expect(soakErr.branchName).toBe('wave/101-mismatch');
  });

  it('falls back to createdAt-based soak when no headSha is provided (backward compat)', async () => {
    // If promoteToProd is called without headSha, the old createdAt behaviour
    // must still work (graceful upgrade path).
    const promoteToProd = await getPromoteToProd();

    const twoHoursAgo = new Date('2026-05-01T10:00:00.000Z');
    const nowTime = new Date('2026-05-01T12:00:00.000Z');

    await insertCloneRow(memClient, {
      branchName: 'wave/101-compat',
      tursoDbName: 'ft-clone-101-abc203',
      createdAt: twoHoursAgo.toISOString(),
      // no headSha/soakStartedAt
    });

    // Should pass using createdAt (2h > 1h requirement)
    const result = await promoteToProd({
      branchName: 'wave/101-compat',
      // no headSha — backward compat path
      minSoakHours: 1,
      metaClient: memClient,
      now: () => nowTime,
      runProdMigration: async () => ({ applied: [], skipped: [] }),
    });

    expect(result.branchName).toBe('wave/101-compat');
  });

  it('SoakNotMetError.soakHoursElapsed reflects time from soak_started_at (not created_at)', async () => {
    const { SoakNotMetError } = await import('@/lib/ops/branch-clone');
    const promoteToProd = await getPromoteToProd();
    const recordCiPassForCommit = await getRecordCiPassForCommit();

    // Branch created 5h ago, but CI only passed 30min ago for the current sha
    const fiveHoursAgo = new Date('2026-05-01T07:00:00.000Z');
    const thirtyMinsAgo = new Date('2026-05-01T11:30:00.000Z');
    const nowTime = new Date('2026-05-01T12:00:00.000Z');

    await insertCloneRow(memClient, {
      branchName: 'wave/101-elapsed',
      tursoDbName: 'ft-clone-101-abc204',
      createdAt: fiveHoursAgo.toISOString(),
    });

    await recordCiPassForCommit({
      branchName: 'wave/101-elapsed',
      commitSha: 'sha-recent-ci',
      metaClient: memClient,
      now: () => thirtyMinsAgo,
    });

    let caughtError: unknown;
    try {
      await promoteToProd({
        branchName: 'wave/101-elapsed',
        headSha: 'sha-recent-ci',
        minSoakHours: 1,
        metaClient: memClient,
        now: () => nowTime,
        runProdMigration: async () => ({ applied: [], skipped: [] }),
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(SoakNotMetError);
    const soakErr = caughtError as InstanceType<typeof SoakNotMetError>;
    // elapsed should be ~0.5h (from soak_started_at), NOT 5h (from created_at)
    expect(soakErr.soakHoursElapsed).toBeCloseTo(0.5, 1);
  });
});
