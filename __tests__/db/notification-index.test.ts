/**
 * Guards Phase-J performance fix: the `/api/notifications` cache-miss query
 * filters by `expiresAt > now` and sorts by `[isRead, createdAt]`. Without a
 * composite index whose prefix serves the predicate, the query falls back to a
 * filter-scan over the sort output and regresses linearly with notification
 * volume.
 *
 * These tests assert BOTH sides of the fix:
 *   1. `prisma/schema.prisma` declares a composite index covering
 *      `(expiresAt, isRead, createdAt)` on the Notification model.
 *   2. `migrations/0002_notification_expires_index.sql` creates that index
 *      and is idempotent under re-runs (safe for partially-migrated tenants).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';

const REPO_ROOT = join(__dirname, '..', '..');

async function readSchema(): Promise<string> {
  return readFile(join(REPO_ROOT, 'prisma', 'schema.prisma'), 'utf-8');
}

async function readMigration(): Promise<string> {
  return readFile(
    join(REPO_ROOT, 'migrations', '0002_notification_expires_index.sql'),
    'utf-8',
  );
}

/**
 * Extract the body (between the opening `{` and the matching closing `}`) of
 * the Notification model. Keeps the parser simple without pulling in
 * @prisma/internals — we only need to reason about `@@index` declarations.
 */
function extractNotificationModel(schema: string): string {
  const marker = /model\s+Notification\s*\{/;
  const match = marker.exec(schema);
  if (!match) throw new Error('Notification model not found in schema.prisma');
  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < schema.length; i++) {
    const ch = schema[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return schema.slice(start, i);
    }
  }
  throw new Error('Unterminated Notification model block');
}

describe('Notification schema — composite expiresAt index (Phase-J perf)', () => {
  it('declares an @@index whose leading field is expiresAt', async () => {
    const schema = await readSchema();
    const body = extractNotificationModel(schema);

    // Collect every `@@index([...])` declaration and its field list.
    const indexRe = /@@index\(\s*\[([^\]]+)\]/g;
    const fieldLists: string[][] = [];
    let m: RegExpExecArray | null;
    while ((m = indexRe.exec(body)) !== null) {
      const fields = m[1]
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
      fieldLists.push(fields);
    }

    const hasExpiresAtPrefix = fieldLists.some(
      (fields) => fields[0] === 'expiresAt',
    );
    expect(hasExpiresAtPrefix, {
      message:
        'Notification needs an @@index whose first field is expiresAt to serve the `expiresAt > now` cache-miss filter',
    } as unknown as string).toBe(true);
  });

  it('covers expiresAt, isRead, and createdAt in one composite index', async () => {
    const schema = await readSchema();
    const body = extractNotificationModel(schema);

    const indexRe = /@@index\(\s*\[([^\]]+)\]/g;
    const fieldLists: string[][] = [];
    let m: RegExpExecArray | null;
    while ((m = indexRe.exec(body)) !== null) {
      const fields = m[1]
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
      fieldLists.push(fields);
    }

    const composite = fieldLists.find(
      (fields) =>
        fields.includes('expiresAt') &&
        fields.includes('isRead') &&
        fields.includes('createdAt'),
    );
    expect(composite).toBeDefined();
  });
});

describe('Migration 0002 — notification expiresAt composite index', () => {
  it('creates an index named idx_notification_expires_read_created', async () => {
    const sql = await readMigration();
    expect(sql).toMatch(/idx_notification_expires_read_created/);
    expect(sql).toMatch(/CREATE\s+INDEX/i);
    expect(sql).toMatch(/expiresAt/);
    expect(sql).toMatch(/isRead/);
    expect(sql).toMatch(/createdAt/);
  });

  it('uses CREATE INDEX IF NOT EXISTS for idempotency', async () => {
    const sql = await readMigration();
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
  });

  describe('applied against an in-memory libsql DB', () => {
    let db: Client;

    beforeEach(async () => {
      db = createClient({ url: ':memory:' });
      // Minimal Notification table shape — enough columns for the index.
      await db.execute(`
        CREATE TABLE "Notification" (
          "id"        TEXT PRIMARY KEY,
          "isRead"    INTEGER NOT NULL DEFAULT 0,
          "createdAt" TEXT NOT NULL,
          "expiresAt" TEXT NOT NULL
        )
      `);
    });

    it('creates the index on first run', async () => {
      const sql = await readMigration();
      await db.executeMultiple(sql);
      const res = await db.execute(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notification_expires_read_created'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('is idempotent — re-running does not throw', async () => {
      const sql = await readMigration();
      await db.executeMultiple(sql);
      // Second apply must not throw thanks to IF NOT EXISTS.
      await expect(db.executeMultiple(sql)).resolves.not.toThrow();

      const res = await db.execute(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notification_expires_read_created'`,
      );
      expect(res.rows.length).toBe(1);
    });
  });
});
