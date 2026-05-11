/**
 * Issue #207 — migration smoke test for 0020_animal_cover_idempotency.sql.
 *
 * Mirrors `__tests__/db/observation-idempotency-migration.test.ts` (#206)
 * one-for-one. Asserts that the migration:
 *   - Adds `clientLocalId` TEXT columns to BOTH `Animal` and
 *     `CampCoverReading` (single migration file, two tables — see comment in
 *     `migrations/0020_animal_cover_idempotency.sql`).
 *   - Creates UNIQUE INDEXES named `idx_animal_client_local_id` and
 *     `idx_camp_cover_reading_client_local_id`, each guarded by
 *     `IF NOT EXISTS` for partial-apply safety.
 *   - Round-trips through the canonical `runMigrations` runner cleanly,
 *     including `verifyMigrationApplied` (catches the silent-failure class
 *     from PRD #128 § wave 132).
 *   - Enforces uniqueness on non-null `clientLocalId` values (two inserts
 *     with the same UUID raise a UNIQUE constraint), while allowing multiple
 *     NULLs (back-compat with legacy rows).
 *
 * Pure SQL/schema test — no Prisma client, no domain ops.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';

import { runMigrations, splitSqlStatements } from '@/lib/migrator';

const REPO_ROOT = join(__dirname, '..', '..');

async function readMigration(): Promise<string> {
  return readFile(
    join(REPO_ROOT, 'migrations', '0020_animal_cover_idempotency.sql'),
    'utf-8',
  );
}

describe('migration 0020_animal_cover_idempotency — SQL shape', () => {
  it('adds clientLocalId TEXT column to Animal AND CampCoverReading', async () => {
    const sql = await readMigration();
    expect(
      sql,
      'must add clientLocalId column to Animal',
    ).toMatch(
      /ALTER\s+TABLE\s+"?Animal"?\s+ADD\s+COLUMN\s+"?clientLocalId"?\s+TEXT/i,
    );
    expect(
      sql,
      'must add clientLocalId column to CampCoverReading',
    ).toMatch(
      /ALTER\s+TABLE\s+"?CampCoverReading"?\s+ADD\s+COLUMN\s+"?clientLocalId"?\s+TEXT/i,
    );
  });

  it('creates two UNIQUE INDEXES guarded by IF NOT EXISTS', async () => {
    const sql = await readMigration();
    // Animal index
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"?idx_animal_client_local_id"?/i,
    );
    expect(sql).toMatch(
      /ON\s+"?Animal"?\s*\(\s*"?clientLocalId"?\s*\)/i,
    );
    // CampCoverReading index
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"?idx_camp_cover_reading_client_local_id"?/i,
    );
    expect(sql).toMatch(
      /ON\s+"?CampCoverReading"?\s*\(\s*"?clientLocalId"?\s*\)/i,
    );
  });
});

describe('migration 0020_animal_cover_idempotency — applies against in-memory libsql', () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    // Minimal pre-0020 shape for both tables — only the columns the migration
    // probe / the post-migration assertions touch are present.
    await db.execute(`
      CREATE TABLE "Animal" (
        "id"          TEXT PRIMARY KEY,
        "animalId"    TEXT UNIQUE NOT NULL,
        "sex"         TEXT NOT NULL,
        "category"    TEXT NOT NULL,
        "currentCamp" TEXT NOT NULL,
        "status"      TEXT NOT NULL DEFAULT 'Active',
        "dateAdded"   TEXT NOT NULL,
        "species"     TEXT NOT NULL DEFAULT 'cattle',
        "breed"       TEXT NOT NULL DEFAULT 'Brangus'
      )
    `);
    await db.execute(`
      CREATE TABLE "CampCoverReading" (
        "id"            TEXT PRIMARY KEY,
        "campId"        TEXT NOT NULL,
        "coverCategory" TEXT NOT NULL,
        "kgDmPerHa"     REAL NOT NULL,
        "useFactor"     REAL NOT NULL DEFAULT 0.35,
        "recordedAt"    TEXT NOT NULL,
        "recordedBy"    TEXT NOT NULL
      )
    `);
  });

  it('applies cleanly via the canonical migrator (verifyMigrationApplied passes for both columns + indexes)', async () => {
    const sql = await readMigration();
    const result = await runMigrations(db, [
      { name: '0020_animal_cover_idempotency.sql', sql },
    ]);
    expect(result.applied).toContain('0020_animal_cover_idempotency.sql');

    // Both columns landed.
    const animalCols = await db.execute(`SELECT name FROM pragma_table_info('Animal')`);
    const animalColNames = new Set(animalCols.rows.map((r) => r.name as string));
    expect(animalColNames.has('clientLocalId')).toBe(true);

    const coverCols = await db.execute(
      `SELECT name FROM pragma_table_info('CampCoverReading')`,
    );
    const coverColNames = new Set(coverCols.rows.map((r) => r.name as string));
    expect(coverColNames.has('clientLocalId')).toBe(true);

    // Both indexes landed.
    const idxAnimal = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_animal_client_local_id'`,
    );
    expect(idxAnimal.rows.length).toBe(1);
    const idxCover = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_camp_cover_reading_client_local_id'`,
    );
    expect(idxCover.rows.length).toBe(1);
  });

  it('rejects duplicate non-null clientLocalId on Animal (UNIQUE constraint)', async () => {
    const sql = await readMigration();
    for (const stmt of splitSqlStatements(sql)) {
      await db.execute(stmt);
    }

    await db.execute({
      sql: `INSERT INTO "Animal" (id, animalId, sex, category, currentCamp, status, dateAdded, species, breed, clientLocalId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a1', 'A-001', 'Female', 'Cow', 'A', 'Active', '2026-05-11', 'cattle', 'Brangus', 'uuid-1'],
    });

    await expect(
      db.execute({
        sql: `INSERT INTO "Animal" (id, animalId, sex, category, currentCamp, status, dateAdded, species, breed, clientLocalId)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ['a2', 'A-002', 'Female', 'Cow', 'A', 'Active', '2026-05-11', 'cattle', 'Brangus', 'uuid-1'],
      }),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it('rejects duplicate non-null clientLocalId on CampCoverReading (UNIQUE constraint)', async () => {
    const sql = await readMigration();
    for (const stmt of splitSqlStatements(sql)) {
      await db.execute(stmt);
    }

    await db.execute({
      sql: `INSERT INTO "CampCoverReading" (id, campId, coverCategory, kgDmPerHa, useFactor, recordedAt, recordedBy, clientLocalId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['r1', 'A', 'Good', 2000, 0.35, '2026-05-11T10:00:00Z', 'logger@example.com', 'uuid-X'],
    });

    await expect(
      db.execute({
        sql: `INSERT INTO "CampCoverReading" (id, campId, coverCategory, kgDmPerHa, useFactor, recordedAt, recordedBy, clientLocalId)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ['r2', 'A', 'Fair', 1100, 0.35, '2026-05-11T10:00:00Z', 'logger@example.com', 'uuid-X'],
      }),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it('allows multiple NULL clientLocalId rows on Animal (back-compat with legacy data)', async () => {
    const sql = await readMigration();
    for (const stmt of splitSqlStatements(sql)) {
      await db.execute(stmt);
    }

    await db.execute({
      sql: `INSERT INTO "Animal" (id, animalId, sex, category, currentCamp, status, dateAdded, species, breed, clientLocalId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a1', 'A-001', 'Female', 'Cow', 'A', 'Active', '2026-05-11', 'cattle', 'Brangus', null],
    });
    await db.execute({
      sql: `INSERT INTO "Animal" (id, animalId, sex, category, currentCamp, status, dateAdded, species, breed, clientLocalId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a2', 'A-002', 'Female', 'Cow', 'A', 'Active', '2026-05-11', 'cattle', 'Brangus', null],
    });

    const rows = await db.execute(`SELECT COUNT(*) AS c FROM "Animal"`);
    expect(Number(rows.rows[0]?.c)).toBe(2);
  });

  it('allows multiple NULL clientLocalId rows on CampCoverReading (back-compat with legacy data)', async () => {
    const sql = await readMigration();
    for (const stmt of splitSqlStatements(sql)) {
      await db.execute(stmt);
    }

    await db.execute({
      sql: `INSERT INTO "CampCoverReading" (id, campId, coverCategory, kgDmPerHa, useFactor, recordedAt, recordedBy, clientLocalId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['r1', 'A', 'Good', 2000, 0.35, '2026-05-11T10:00:00Z', 'logger@example.com', null],
    });
    await db.execute({
      sql: `INSERT INTO "CampCoverReading" (id, campId, coverCategory, kgDmPerHa, useFactor, recordedAt, recordedBy, clientLocalId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['r2', 'A', 'Fair', 1100, 0.35, '2026-05-11T10:00:00Z', 'logger@example.com', null],
    });

    const rows = await db.execute(`SELECT COUNT(*) AS c FROM "CampCoverReading"`);
    expect(Number(rows.rows[0]?.c)).toBe(2);
  });
});
