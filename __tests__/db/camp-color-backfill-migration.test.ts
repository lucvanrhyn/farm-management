/**
 * Issue #470 — migration smoke test for 0025_backfill_empty_camp_color.sql.
 *
 * Wave 2 of PRD #464. The complementary DATA-LAYER cleanup to issue #466
 * (PR #471), which added the runtime normaliser `normaliseCampColor()` in
 * `components/map/layers/_camp-colors.ts`. That guard maps empty-string /
 * whitespace-only / invalid `Camp.color` values to a safe default before
 * they reach the Mapbox `["to-color", ["get", "borderColor"]]` paint
 * expression (those bad values fired a "could not parse color" style-error
 * and mis-rendered the affected camps).
 *
 * This migration backfills the persisted column so the stored data itself is
 * sane: every empty-string / whitespace-only `Camp.color` becomes `NULL`
 * (the canonical "no custom colour" sentinel). The runtime normaliser then
 * becomes a belt-and-braces backstop rather than the only thing standing
 * between dirty data and a crash.
 *
 * Mirrors the in-memory libsql migration smoke tests for 0019/0020 one-for-
 * one (`observation-idempotency-migration.test.ts`,
 * `animal-cover-idempotency-migration.test.ts`). Pure SQL test — no Prisma
 * client, no domain ops.
 *
 * TDD seam: the load-bearing post-condition is that NO empty/blank colour
 * survives the migration —
 *   `SELECT COUNT(*) FROM Camp WHERE color IS NOT NULL AND TRIM(color) = ''`
 * must be 0. This assertion fails against dirty pre-migration data (RED) and
 * passes once the UPDATE runs (GREEN).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';

import { runMigrations } from '@/lib/migrator';

const REPO_ROOT = join(__dirname, '..', '..');
const MIGRATION_NAME = '0025_backfill_empty_camp_color.sql';

async function readMigration(): Promise<string> {
  return readFile(join(REPO_ROOT, 'migrations', MIGRATION_NAME), 'utf-8');
}

/** Count rows whose persisted colour is empty/whitespace-only (the dirty set). */
async function countDirtyColors(db: Client): Promise<number> {
  const res = await db.execute(
    `SELECT COUNT(*) AS c FROM "Camp" WHERE "color" IS NOT NULL AND TRIM("color") = ''`,
  );
  return Number(res.rows[0]?.c);
}

describe('migration 0025_backfill_empty_camp_color — SQL shape', () => {
  it('is a TRIM-based UPDATE setting Camp.color to NULL for blank values', async () => {
    const sql = await readMigration();
    expect(
      sql,
      'must UPDATE Camp SET color = NULL guarded by a TRIM(...) = \'\' predicate',
    ).toMatch(
      /UPDATE\s+"?Camp"?\s+SET\s+"?color"?\s*=\s*NULL\s+WHERE[\s\S]*TRIM\s*\(\s*"?color"?\s*\)\s*=\s*''/i,
    );
  });

  it('guards on color IS NOT NULL so already-NULL rows are untouched (idempotency)', async () => {
    const sql = await readMigration();
    expect(sql).toMatch(/"?color"?\s+IS\s+NOT\s+NULL/i);
  });
});

describe('migration 0025_backfill_empty_camp_color — applies against in-memory libsql', () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    // Minimal Camp shape — only the columns the migration / assertions touch.
    await db.execute(`
      CREATE TABLE "Camp" (
        "id"       TEXT PRIMARY KEY,
        "campId"   TEXT NOT NULL,
        "campName" TEXT NOT NULL,
        "species"  TEXT NOT NULL DEFAULT 'cattle',
        "color"    TEXT
      )
    `);
    // Seed the colour-value taxonomy. NOTE: SQLite's `TRIM(x)` (no charset
    // arg) strips only ASCII spaces (0x20) — NOT tabs/newlines. The migration
    // therefore canonicalises the realistic dirty set (empty + space-padded
    // values, which is what blank form inputs persist) to NULL. The rarer
    // tab/newline-only case is deliberately left to the runtime normaliser
    // `normaliseCampColor()` (#466, JS `.trim()` strips all Unicode
    // whitespace) — that backstop is exactly why the two halves are
    // complementary. c3 below documents that boundary.
    const seed: Array<[string, string, string | null]> = [
      ['c1', 'A-01', ''],            // empty string — DIRTY (nulled)
      ['c2', 'A-02', '   '],         // space-only — DIRTY (nulled)
      ['c3', 'A-03', '\t\n'],        // tab/newline-only — runtime-backstop domain, NOT nulled by SQL TRIM
      ['c4', 'A-04', '#22c55e'],     // valid hex — KEEP
      ['c5', 'A-05', '  #abc  '],    // padded valid hex (non-blank) — KEEP, NOT trimmed
      ['c6', 'A-06', null],          // already NULL — untouched
    ];
    for (const [id, campId, color] of seed) {
      await db.execute({
        sql: `INSERT INTO "Camp" (id, campId, campName, species, color)
              VALUES (?, ?, ?, 'cattle', ?)`,
        args: [id, campId, `Camp ${campId}`, color],
      });
    }
  });

  it('starts dirty: two SQL-TRIM-blank colour rows exist before migration (RED baseline)', async () => {
    // `countDirtyColors` uses the same `TRIM(color) = ''` predicate as the
    // migration, so it sees the empty + space-only rows (c1, c2) but not the
    // tab/newline-only row (c3 — runtime-backstop domain).
    expect(await countDirtyColors(db)).toBe(2);
  });

  it('round-trips through the canonical migrator and nulls every SQL-blank colour', async () => {
    const sql = await readMigration();
    const result = await runMigrations(db, [{ name: MIGRATION_NAME, sql }]);
    expect(result.applied).toContain(MIGRATION_NAME);

    // The load-bearing post-condition: no SQL-TRIM-blank colour survives.
    expect(await countDirtyColors(db)).toBe(0);

    // c1 (empty) + c2 (space-only) joined the already-NULL c6. c3
    // (tab/newline-only) is intentionally NOT nulled by SQLite TRIM and is
    // left for the runtime normaliser.
    const nulls = await db.execute(
      `SELECT id FROM "Camp" WHERE "color" IS NULL ORDER BY id`,
    );
    expect(nulls.rows.map((r) => r.id)).toEqual(['c1', 'c2', 'c6']);
  });

  it('leaves valid (non-blank) colours untouched — does not trim or null them', async () => {
    const sql = await readMigration();
    await runMigrations(db, [{ name: MIGRATION_NAME, sql }]);

    const valid = await db.execute(
      `SELECT id, color FROM "Camp" WHERE id IN ('c4', 'c5') ORDER BY id`,
    );
    expect(valid.rows.map((r) => [r.id, r.color])).toEqual([
      ['c4', '#22c55e'],
      ['c5', '  #abc  '], // padded-but-non-blank colour is preserved verbatim
    ]);
  });

  it('is idempotent: re-running the SQL changes nothing further', async () => {
    const sql = await readMigration();
    await runMigrations(db, [{ name: MIGRATION_NAME, sql }]);

    const afterFirst = await db.execute(`SELECT id, color FROM "Camp" ORDER BY id`);
    const snapshot = afterFirst.rows.map((r) => [r.id, r.color]);

    // Re-apply the raw UPDATE directly (the migrator would skip it via
    // `_migrations` bookkeeping, so we exercise the SQL's own idempotency).
    await db.execute(sql);

    const afterSecond = await db.execute(`SELECT id, color FROM "Camp" ORDER BY id`);
    expect(afterSecond.rows.map((r) => [r.id, r.color])).toEqual(snapshot);
    expect(await countDirtyColors(db)).toBe(0);
  });
});
