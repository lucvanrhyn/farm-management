/**
 * Wave/131 (issue #131) — Prisma-vs-live-DB column parity check.
 *
 * Closes the audit gap that hid basson's `Animal.species` drift in Wave 0:
 * the column was declared in `prisma/schema.prisma` but no migration file
 * ever declared it. The old audit (`checkSchemaParity`) said `ok=true`
 * because every migration file's `_migrations` row was present, while the
 * live table was missing the column. This new check parses the Prisma
 * schema and compares against `pragma_table_info` per tenant.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import {
  parsePrismaSchema,
  expectedColumnsByTable,
} from '../../lib/ops/parse-prisma-schema';
import {
  checkPrismaColumnParity,
  formatColumnParityResults,
} from '../../lib/ops/schema-parity';

async function openMemoryDb(): Promise<Client> {
  return createClient({ url: ':memory:' });
}

describe('parsePrismaSchema — extracts scalar columns per model', () => {
  it('extracts simple scalar fields, ignoring relation fields', () => {
    const src = `
      model Animal {
        id          String   @id @default(cuid())
        animalId    String   @unique
        name        String?
        species     String   @default("cattle")
        speciesData String?
        // Relation field — must be excluded
        importJob   ImportJob? @relation(fields: [importJobId], references: [id])
        importJobId String?

        @@index([species])
      }

      model ImportJob {
        id   String @id
      }
    `;
    const models = parsePrismaSchema(src);
    const animal = models.find((m) => m.name === 'Animal');
    expect(animal).toBeDefined();
    expect(animal!.table).toBe('Animal');
    // importJob (relation) excluded; importJobId (scalar FK) included
    expect(animal!.columns.sort()).toEqual(
      ['animalId', 'id', 'importJobId', 'name', 'species', 'speciesData'].sort(),
    );
  });

  it('respects @@map for table name overrides', () => {
    const src = `
      model RainfallRecord {
        id String @id
        @@map("GameRainfallRecord")
      }
    `;
    const models = parsePrismaSchema(src);
    expect(models[0].table).toBe('GameRainfallRecord');
    expect(models[0].name).toBe('RainfallRecord');
  });

  it('respects @map for column name overrides', () => {
    const src = `
      model Foo {
        id          String @id
        camelCase   String @map("snake_case_col")
      }
    `;
    const models = parsePrismaSchema(src);
    expect(models[0].columns.sort()).toEqual(['id', 'snake_case_col']);
  });

  it('excludes array-of-model relation fields (Foo[])', () => {
    const src = `
      model User {
        id    String @id
        posts Post[]
      }
      model Post {
        id String @id
      }
    `;
    const models = parsePrismaSchema(src);
    const user = models.find((m) => m.name === 'User');
    expect(user!.columns).toEqual(['id']); // posts excluded
  });

  it('handles enum-typed scalar fields as columns', () => {
    const src = `
      enum Role {
        ADMIN
        USER
      }
      model User {
        id   String @id
        role Role   @default(USER)
      }
    `;
    const models = parsePrismaSchema(src);
    const user = models.find((m) => m.name === 'User');
    expect(user!.columns.sort()).toEqual(['id', 'role']);
  });

  it('strips line comments before parsing', () => {
    const src = `
      model Foo {
        id String @id
        // bar Banned String  -- this should not appear as a column
        baz String
      }
    `;
    const models = parsePrismaSchema(src);
    expect(models[0].columns.sort()).toEqual(['baz', 'id']);
  });

  it('parses the real prisma/schema.prisma without crashing', async () => {
    const repoRoot = join(__dirname, '..', '..');
    const src = await readFile(join(repoRoot, 'prisma', 'schema.prisma'), 'utf-8');
    const models = parsePrismaSchema(src);

    // Sanity checks against known schema content (won't break unless the
    // schema itself is rewritten).
    expect(models.length).toBeGreaterThan(20);
    const animal = models.find((m) => m.name === 'Animal');
    expect(animal).toBeDefined();
    expect(animal!.columns).toContain('species');
    expect(animal!.columns).toContain('speciesData');
    expect(animal!.columns).toContain('updatedAt');
    // Relation fields excluded:
    expect(animal!.columns).not.toContain('importJob');
    // FK scalar included:
    expect(animal!.columns).toContain('importJobId');

    // RainfallRecord uses @@map.
    const rainfall = models.find((m) => m.name === 'RainfallRecord');
    expect(rainfall!.table).toBe('GameRainfallRecord');
  });
});

describe('checkPrismaColumnParity — diffs Prisma expected vs live DB', () => {
  let db: Client;
  beforeEach(async () => {
    db = await openMemoryDb();
  });

  it('reports ok=true when the live DB has every expected column', async () => {
    await db.execute(`
      CREATE TABLE "Animal" (
        id          TEXT PRIMARY KEY,
        species     TEXT NOT NULL DEFAULT 'cattle',
        speciesData TEXT
      )
    `);
    const expected = new Map<string, string[]>([
      ['Animal', ['id', 'species', 'speciesData']],
    ]);
    const report = await checkPrismaColumnParity(db, { expectedColumns: expected });
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.missingTables).toEqual([]);
    expect(report.checkedTables).toEqual(['Animal']);
  });

  it('detects the basson-style drift: column declared in Prisma but missing from live DB', async () => {
    // Seed an Animal table WITHOUT species + speciesData — exactly the
    // basson cohort. This is the case the old audit (#129) could not catch.
    await db.execute(`CREATE TABLE "Animal" ( id TEXT PRIMARY KEY )`);

    const expected = new Map<string, string[]>([
      ['Animal', ['id', 'species', 'speciesData']],
    ]);
    const report = await checkPrismaColumnParity(db, { expectedColumns: expected });

    expect(report.ok).toBe(false);
    expect(report.missing).toEqual([
      { table: 'Animal', column: 'species' },
      { table: 'Animal', column: 'speciesData' },
    ]);
    expect(report.missingTables).toEqual([]);
    expect(report.checkedTables).toEqual(['Animal']);
  });

  it('reports a missing table separately from missing columns', async () => {
    await db.execute(`CREATE TABLE "Animal" ( id TEXT PRIMARY KEY )`);
    // Camp doesn't exist at all.

    const expected = new Map<string, string[]>([
      ['Animal', ['id']],
      ['Camp', ['id', 'name']],
    ]);
    const report = await checkPrismaColumnParity(db, { expectedColumns: expected });

    expect(report.ok).toBe(false);
    expect(report.missingTables).toEqual(['Camp']);
    expect(report.missing).toEqual([]);
    expect(report.checkedTables).toEqual(['Animal']);
  });

  it('honors `onlyTables` to scope the check', async () => {
    await db.execute(`CREATE TABLE "Animal" ( id TEXT PRIMARY KEY )`);
    await db.execute(`CREATE TABLE "Camp"   ( id TEXT PRIMARY KEY )`);

    const expected = new Map<string, string[]>([
      ['Animal', ['id', 'species']], // missing species
      ['Camp', ['id']],
    ]);
    // Restrict to Camp — Animal's missing column is ignored.
    const report = await checkPrismaColumnParity(db, {
      expectedColumns: expected,
      onlyTables: ['Camp'],
    });
    expect(report.ok).toBe(true);
    expect(report.checkedTables).toEqual(['Camp']);
  });

  it('binds table names as parameters (no SQL injection in pragma_table_info)', async () => {
    // A table name containing a quote would break a string-interpolated
    // PRAGMA. This test exists to pin the parameter-binding contract — if
    // someone refactors back to template-string interpolation, this fires.
    await db.execute(`CREATE TABLE "weird'table" ( id TEXT PRIMARY KEY )`);
    const expected = new Map<string, string[]>([["weird'table", ['id']]]);
    const report = await checkPrismaColumnParity(db, { expectedColumns: expected });
    expect(report.ok).toBe(true);
  });
});

describe('end-to-end: parsing the real schema + checking a basson-style DB', () => {
  it('would have caught the wave/130 basson Animal.species drift', async () => {
    const db = await openMemoryDb();
    // Seed Animal WITHOUT species — the pre-fix basson state.
    await db.execute(`CREATE TABLE "Animal" ( id TEXT PRIMARY KEY )`);

    const repoRoot = join(__dirname, '..', '..');
    const src = await readFile(join(repoRoot, 'prisma', 'schema.prisma'), 'utf-8');
    const models = parsePrismaSchema(src);
    const expected = expectedColumnsByTable(models);

    const report = await checkPrismaColumnParity(db, {
      expectedColumns: expected,
      onlyTables: ['Animal'],
    });

    expect(report.ok).toBe(false);
    const missingNames = report.missing.map((m) => m.column);
    expect(missingNames).toContain('species');
    expect(missingNames).toContain('speciesData');
    // Other animal columns are also missing in this contrived DB. This
    // test deliberately doesn't pin the full count — only that the
    // basson regression columns surface.
  });
});

describe('formatColumnParityResults — human-readable summary', () => {
  it('declares all-green when every tenant is at parity', () => {
    const out = formatColumnParityResults([
      { slug: 'a', report: { ok: true, checkedTables: ['Animal'], missingTables: [], missing: [] } },
      { slug: 'b', report: { ok: true, checkedTables: ['Animal'], missingTables: [], missing: [] } },
    ]);
    expect(out).toContain('ALL TENANTS GREEN');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('flags drift with table.{col,col} format', () => {
    const out = formatColumnParityResults([
      {
        slug: 'basson',
        report: {
          ok: false,
          checkedTables: ['Animal'],
          missingTables: [],
          missing: [
            { table: 'Animal', column: 'species' },
            { table: 'Animal', column: 'speciesData' },
          ],
        },
      },
    ]);
    expect(out).toContain('DRIFT DETECTED');
    expect(out).toContain('Animal.{species,speciesData}');
  });

  it('reports missing tables and missing columns separately', () => {
    const out = formatColumnParityResults([
      {
        slug: 'partial',
        report: {
          ok: false,
          checkedTables: ['Animal'],
          missingTables: ['Camp'],
          missing: [{ table: 'Animal', column: 'species' }],
        },
      },
    ]);
    expect(out).toContain('missing tables: Camp');
    expect(out).toContain('missing columns: Animal.{species}');
  });
});
