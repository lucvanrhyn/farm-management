import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import {
  checkSchemaParity,
  checkSchemaParityAcrossTenants,
  formatParityResults,
} from '@/lib/ops/schema-parity';

async function seedMigrationsTable(db: Client, names: readonly string[]) {
  await db.execute(
    'CREATE TABLE IF NOT EXISTS "_migrations" (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  for (const name of names) {
    await db.execute({
      sql: 'INSERT INTO "_migrations" (name, applied_at) VALUES (?, ?)',
      args: [name, '2026-05-06T00:00:00.000Z'],
    });
  }
}

describe('checkSchemaParity', () => {
  let db: Client;
  beforeEach(() => {
    db = createClient({ url: ':memory:' });
  });

  it('returns ok when every expected migration is applied', async () => {
    await seedMigrationsTable(db, ['0001_init.sql', '0014_einstein_chunker_version.sql']);
    const r = await checkSchemaParity(db, {
      expected: ['0001_init.sql', '0014_einstein_chunker_version.sql'],
    });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
  });

  it('detects the PRD #128 scenario: 0014 not applied on a tenant', async () => {
    await seedMigrationsTable(db, ['0001_init.sql']); // simulates tenant stuck pre-0014
    const r = await checkSchemaParity(db, {
      expected: ['0001_init.sql', '0014_einstein_chunker_version.sql'],
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['0014_einstein_chunker_version.sql']);
  });

  it('treats a tenant superset as ok when allowExtra is true (default)', async () => {
    await seedMigrationsTable(db, ['0001_init.sql', '9999_test_only.sql']);
    const r = await checkSchemaParity(db, { expected: ['0001_init.sql'] });
    expect(r.ok).toBe(true);
    expect(r.extra).toEqual(['9999_test_only.sql']);
  });

  it('flags extras as not-ok when allowExtra is false', async () => {
    await seedMigrationsTable(db, ['0001_init.sql', '9999_test_only.sql']);
    const r = await checkSchemaParity(db, {
      expected: ['0001_init.sql'],
      allowExtra: false,
    });
    expect(r.ok).toBe(false);
    expect(r.extra).toEqual(['9999_test_only.sql']);
  });

  it('throws a clear error if _migrations table is absent (catastrophic drift)', async () => {
    await expect(
      checkSchemaParity(db, { expected: ['0001_init.sql'] }),
    ).rejects.toThrow(/cannot read "_migrations"/);
  });
});

describe('checkSchemaParityAcrossTenants', () => {
  it('continues past per-tenant errors and aggregates results', async () => {
    const goodDb = createClient({ url: ':memory:' });
    const badDb = createClient({ url: ':memory:' }); // no _migrations table
    await seedMigrationsTable(goodDb, ['0001_init.sql']);

    const results = await checkSchemaParityAcrossTenants(
      [
        { slug: 'good-tenant', client: goodDb },
        { slug: 'bad-tenant', client: badDb },
      ],
      { expected: ['0001_init.sql'] },
    );

    expect(results).toHaveLength(2);
    expect(results[0].slug).toBe('good-tenant');
    expect(results[0].report?.ok).toBe(true);
    expect(results[1].slug).toBe('bad-tenant');
    expect(results[1].error).toMatch(/cannot read "_migrations"/);
  });
});

describe('formatParityResults', () => {
  it('produces a green header when every tenant is at parity', () => {
    const out = formatParityResults([
      {
        slug: 't1',
        report: { expected: ['0001'], applied: ['0001'], missing: [], extra: [], ok: true },
      },
    ]);
    expect(out).toMatch(/ALL TENANTS GREEN/);
    expect(out).toMatch(/✅ t1/);
  });

  it('produces a drift header and lists missing migrations on failure', () => {
    const out = formatParityResults([
      {
        slug: 't1',
        report: {
          expected: ['0001', '0014'],
          applied: ['0001'],
          missing: ['0014'],
          extra: [],
          ok: false,
        },
      },
    ]);
    expect(out).toMatch(/DRIFT DETECTED/);
    expect(out).toMatch(/missing: 0014/);
  });

  it('shows per-tenant connection errors clearly', () => {
    const out = formatParityResults([{ slug: 't1', error: 'connection refused' }]);
    expect(out).toMatch(/❌ t1 — ERROR: connection refused/);
  });
});
