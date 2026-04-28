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
