/**
 * @vitest-environment node
 *
 * Phase E (Einstein-basson catchup) — Animal.species column backfill.
 *
 * Bug: acme-cattle's Animal table is missing the `species` column entirely
 * (basson was provisioned before the multi-species migration; the Phase L
 * embeddings backfill therefore embedded 0 animal chunks for basson because
 * `prisma.animal.findMany({})` throws P2022 when Prisma's generated client
 * tries to project a column that doesn't exist on the underlying DB).
 *
 * Fix: scripts/backfill-animal-species.ts adds the column (idempotently) on
 * any tenant where it's missing, then backfills sensible values inferred from
 * `breed` (or defaults to 'cattle' for FarmTrack's cattle-first install base).
 *
 * These tests assert:
 *   1. The backfill function exists and exposes a callable that accepts a
 *      libsql Client + options.
 *   2. Run against a "basson-shaped" Animal table (no species column), it
 *      adds the column, sets every existing row to a non-null value, and
 *      defaults to 'cattle' when no inference is possible.
 *   3. Run a second time on the same DB (column now present, values set), it
 *      is a no-op — no errors, no overwritten values.
 *   4. After backfill, the Einstein chunker produces ≥1 chunk per animal —
 *      i.e. the species value flows through into renderAnimal output.
 *   5. Run against a "trio-b-shaped" Animal table (column already present and
 *      populated), it leaves rows untouched.
 *
 * The chunker assertion guards the original symptom — "Acme has 0 animal
 * chunks" — by proving the post-backfill row shape produces output identical
 * (in cardinality) to a healthy trio-b row.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { toEmbeddingText } from '@/lib/einstein/chunker';
import {
  backfillAnimalSpeciesOnDb,
  inferSpeciesFromBreed,
} from '@/scripts/backfill-animal-species';

async function listColumns(db: Client, table: string): Promise<string[]> {
  const res = await db.execute(`PRAGMA table_info("${table}")`);
  return res.rows.map((r) => r.name as string);
}

async function selectAnimalRows(
  db: Client,
): Promise<Array<Record<string, unknown>>> {
  const res = await db.execute(`SELECT * FROM "Animal" ORDER BY "animalId"`);
  return res.rows.map((r) => ({ ...r }));
}

/** Animal table shape on basson — missing the `species` column entirely. */
async function createBassonShapedAnimalTable(db: Client): Promise<void> {
  await db.execute(`
    CREATE TABLE "Animal" (
      "id"          TEXT PRIMARY KEY,
      "animalId"    TEXT NOT NULL UNIQUE,
      "name"        TEXT,
      "sex"         TEXT NOT NULL,
      "breed"       TEXT NOT NULL DEFAULT 'Brangus',
      "category"    TEXT NOT NULL,
      "currentCamp" TEXT NOT NULL,
      "status"      TEXT NOT NULL DEFAULT 'Active'
    )
  `);
}

/** Animal table shape on trio-b — species column present + populated. */
async function createTrioBShapedAnimalTable(db: Client): Promise<void> {
  await db.execute(`
    CREATE TABLE "Animal" (
      "id"          TEXT PRIMARY KEY,
      "animalId"    TEXT NOT NULL UNIQUE,
      "name"        TEXT,
      "sex"         TEXT NOT NULL,
      "breed"       TEXT NOT NULL DEFAULT 'Brangus',
      "category"    TEXT NOT NULL,
      "currentCamp" TEXT NOT NULL,
      "status"      TEXT NOT NULL DEFAULT 'Active',
      "species"     TEXT NOT NULL DEFAULT 'cattle'
    )
  `);
}

describe('inferSpeciesFromBreed — heuristic', () => {
  it('returns "cattle" for typical SA cattle breeds', () => {
    expect(inferSpeciesFromBreed('Brangus')).toBe('cattle');
    expect(inferSpeciesFromBreed('Bonsmara')).toBe('cattle');
    expect(inferSpeciesFromBreed('Angus')).toBe('cattle');
    expect(inferSpeciesFromBreed('Nguni')).toBe('cattle');
  });

  it('returns "sheep" for typical SA sheep breeds', () => {
    expect(inferSpeciesFromBreed('Dorper')).toBe('sheep');
    expect(inferSpeciesFromBreed('Merino')).toBe('sheep');
    expect(inferSpeciesFromBreed('Meatmaster')).toBe('sheep');
  });

  it('returns "goat" for typical SA goat breeds', () => {
    expect(inferSpeciesFromBreed('Boer Goat')).toBe('goat');
    expect(inferSpeciesFromBreed('Kalahari Red')).toBe('goat');
  });

  it('returns "cattle" as a safe default for unknown / null breeds', () => {
    expect(inferSpeciesFromBreed(null)).toBe('cattle');
    expect(inferSpeciesFromBreed('')).toBe('cattle');
    expect(inferSpeciesFromBreed('Made-Up-Breed-XYZ')).toBe('cattle');
  });

  it('is case-insensitive', () => {
    expect(inferSpeciesFromBreed('dorper')).toBe('sheep');
    expect(inferSpeciesFromBreed('BRANGUS')).toBe('cattle');
  });
});

describe('backfillAnimalSpeciesOnDb — basson-shaped DB (column missing)', () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    await createBassonShapedAnimalTable(db);

    // Three animals: a cattle breed, a sheep breed, an unknown breed.
    await db.execute({
      sql: `INSERT INTO "Animal"
        (id, animalId, name, sex, breed, category, currentCamp, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a1', 'C0001', 'Bella', 'F', 'Brangus', 'Cow', 'camp-1', 'Active'],
    });
    await db.execute({
      sql: `INSERT INTO "Animal"
        (id, animalId, name, sex, breed, category, currentCamp, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a2', 'S0001', 'Woolly', 'F', 'Dorper', 'Ewe', 'camp-2', 'Active'],
    });
    await db.execute({
      sql: `INSERT INTO "Animal"
        (id, animalId, name, sex, breed, category, currentCamp, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a3', 'X0001', 'Mystery', 'M', 'Made-Up', 'Bull', 'camp-3', 'Active'],
    });
  });

  it('adds the species column when it is missing', async () => {
    expect(await listColumns(db, 'Animal')).not.toContain('species');

    await backfillAnimalSpeciesOnDb(db);

    expect(await listColumns(db, 'Animal')).toContain('species');
  });

  it('backfills every row with a non-null species value', async () => {
    await backfillAnimalSpeciesOnDb(db);

    const rows = await selectAnimalRows(db);
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.species).not.toBeNull();
      expect(typeof r.species).toBe('string');
      expect((r.species as string).length).toBeGreaterThan(0);
    }
  });

  it('infers species from breed when possible', async () => {
    await backfillAnimalSpeciesOnDb(db);

    const rows = await selectAnimalRows(db);
    const byId = new Map(rows.map((r) => [r.animalId as string, r.species]));
    expect(byId.get('C0001')).toBe('cattle');
    expect(byId.get('S0001')).toBe('sheep');
    // Unknown breed → safe default 'cattle' (FarmTrack is cattle-first).
    expect(byId.get('X0001')).toBe('cattle');
  });

  it('is idempotent — second run does not throw and does not overwrite', async () => {
    await backfillAnimalSpeciesOnDb(db);
    const beforeRows = await selectAnimalRows(db);

    // Second run on the now-migrated DB: must be a clean no-op.
    await expect(backfillAnimalSpeciesOnDb(db)).resolves.toBeDefined();

    const afterRows = await selectAnimalRows(db);
    expect(afterRows).toEqual(beforeRows);
  });

  it('reports per-row outcomes from the function return value', async () => {
    const result = await backfillAnimalSpeciesOnDb(db);
    expect(result.columnAdded).toBe(true);
    expect(result.rowsUpdated).toBe(3);

    const second = await backfillAnimalSpeciesOnDb(db);
    expect(second.columnAdded).toBe(false);
    expect(second.rowsUpdated).toBe(0);
  });

  it('produces ≥1 Einstein chunk per animal after backfill (the symptom guard)', async () => {
    await backfillAnimalSpeciesOnDb(db);

    const rows = await selectAnimalRows(db);
    expect(rows.length).toBe(3);

    for (const row of rows) {
      const chunks = toEmbeddingText({
        entityType: 'animal',
        entityId: row.id as string,
        row,
      });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // The species value should appear in the chunk text — proves it flowed
      // through the renderer rather than getting dropped as null.
      expect(chunks[0].text).toContain(row.species as string);
    }
  });
});

describe('backfillAnimalSpeciesOnDb — trio-b-shaped DB (column present)', () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    await createTrioBShapedAnimalTable(db);

    await db.execute({
      sql: `INSERT INTO "Animal"
        (id, animalId, name, sex, breed, category, currentCamp, status, species)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a1', 'C0001', 'Bella', 'F', 'Brangus', 'Cow', 'camp-1', 'Active', 'cattle'],
    });
    await db.execute({
      sql: `INSERT INTO "Animal"
        (id, animalId, name, sex, breed, category, currentCamp, status, species)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a2', 'S0001', 'Woolly', 'F', 'Dorper', 'Ewe', 'camp-2', 'Active', 'sheep'],
    });
  });

  it('does not add the column or modify any row when species is already populated', async () => {
    const before = await selectAnimalRows(db);

    const result = await backfillAnimalSpeciesOnDb(db);
    expect(result.columnAdded).toBe(false);
    expect(result.rowsUpdated).toBe(0);

    const after = await selectAnimalRows(db);
    expect(after).toEqual(before);
  });
});

describe('backfillAnimalSpeciesOnDb — partial-state DB (column present, some null)', () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    // Column present but nullable (mirrors the half-fixed scenario).
    await db.execute(`
      CREATE TABLE "Animal" (
        "id"          TEXT PRIMARY KEY,
        "animalId"    TEXT NOT NULL UNIQUE,
        "name"        TEXT,
        "sex"         TEXT NOT NULL,
        "breed"       TEXT NOT NULL DEFAULT 'Brangus',
        "category"    TEXT NOT NULL,
        "currentCamp" TEXT NOT NULL,
        "status"      TEXT NOT NULL DEFAULT 'Active',
        "species"     TEXT
      )
    `);
    await db.execute({
      sql: `INSERT INTO "Animal"
        (id, animalId, name, sex, breed, category, currentCamp, status, species)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a1', 'C0001', 'Bella', 'F', 'Brangus', 'Cow', 'camp-1', 'Active', null],
    });
    await db.execute({
      sql: `INSERT INTO "Animal"
        (id, animalId, name, sex, breed, category, currentCamp, status, species)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['a2', 'S0001', 'Woolly', 'F', 'Dorper', 'Ewe', 'camp-2', 'Active', 'sheep'],
    });
  });

  it('only fills null rows, leaves explicitly-set rows untouched', async () => {
    const result = await backfillAnimalSpeciesOnDb(db);
    expect(result.columnAdded).toBe(false);
    expect(result.rowsUpdated).toBe(1);

    const rows = await selectAnimalRows(db);
    const byId = new Map(rows.map((r) => [r.animalId as string, r.species]));
    expect(byId.get('C0001')).toBe('cattle'); // backfilled from 'Brangus'
    expect(byId.get('S0001')).toBe('sheep');   // pre-existing, untouched
  });
});
