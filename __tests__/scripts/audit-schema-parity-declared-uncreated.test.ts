// @vitest-environment node
/**
 * Tests for the "declared-but-uncreated column" guard added to
 * scripts/audit-schema-parity.ts (issue #282, parent PRD #279 finding #1).
 *
 * Motivating bug class (incident 2026-05-16, issue #280 / PR #298): 21
 * columns were declared on `model FarmSettings` in `prisma/schema.prisma`
 * but were NEVER created by the canonical tenant bootstrap DDL
 * (`lib/farm-schema.ts FARM_SCHEMA_SQL`) nor by any numbered migration.
 * They only ever existed on tenants that had been `prisma db push`-ed (the
 * forbidden path). The existing per-tenant column-parity arm
 * (`checkPrismaColumnParityAcrossTenants`) needs live tenant connectivity
 * and only catches it once a tenant is already drifted in prod. This guard
 * is STATIC: it diffs the Prisma-declared column set against the union of
 * (bootstrap DDL + every migration's DDL) with zero DB access, so the
 * regression class is caught at PR time before any tenant is touched.
 *
 * `computeDeclaredButUncreatedColumns(...)` is the pure core:
 *   in:  prismaSchemaSrc (string), bootstrapDdl (string), migrations (name+sql[])
 *   out: sorted `MissingDdlColumn[]` ({ table, column }) — columns declared
 *        in Prisma with no CREATE TABLE body / ADD COLUMN that creates them.
 *
 * False-positive safety is the #1 risk: this runs in the `gate` with
 * `--fail-on-drift`; a false positive jams the prod-promote pipeline
 * repo-wide (this exact incident happened on #280). The tests below lock
 * the non-false-positive cases that a naive regex would trip on:
 * relation fields, `@map`/`@@map` rewrites, composite/array fields,
 * enum-as-TEXT, quoted identifiers in DDL, IF NOT EXISTS, and CREATE TABLE
 * bodies (the bootstrap path creates columns inside the body, not via
 * ADD COLUMN).
 */

import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  computeDeclaredButUncreatedColumns,
  formatDeclaredButUncreatedColumns,
  LEGACY_DECLARED_BUT_UNCREATED_BASELINE,
  type MissingDdlColumn,
} from '@/scripts/audit-schema-parity';
import { FARM_SCHEMA_SQL } from '@/lib/farm-schema';

const BOOTSTRAP_FULL = `
-- CreateTable
CREATE TABLE "Animal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "animalId" TEXT NOT NULL,
    "name" TEXT
);

-- CreateTable
CREATE TABLE "FarmSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "farmName" TEXT NOT NULL DEFAULT 'My Farm'
);
`;

describe('computeDeclaredButUncreatedColumns', () => {
  it('reports a Prisma-declared column that no bootstrap DDL or migration creates (acceptance #1 + #3)', () => {
    const prisma = `
model Animal {
  id       String @id
  animalId String
  name     String?
  species  String @default("cattle")
}
`;
    // species is declared in Prisma but neither bootstrap nor any migration
    // creates it.
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: BOOTSTRAP_FULL,
      migrations: [],
    });

    expect(result).toEqual<MissingDdlColumn[]>([
      { table: 'Animal', column: 'species' },
    ]);
    // Failure output must name the offending table.column (acceptance #3).
    const formatted = formatDeclaredButUncreatedColumns(result);
    expect(formatted).toMatch(/Animal\.species/);
    expect(formatted).toMatch(/DRIFT|declared/i);
  });

  it('passes once a migration adds the missing column (acceptance #2)', () => {
    const prisma = `
model Animal {
  id       String @id
  animalId String
  name     String?
  species  String @default("cattle")
}
`;
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: BOOTSTRAP_FULL,
      migrations: [
        {
          name: '0017_animal_species_columns.sql',
          sql: `ALTER TABLE "Animal" ADD COLUMN "species" TEXT NOT NULL DEFAULT 'cattle';`,
        },
      ],
    });

    expect(result).toEqual([]);
    expect(formatDeclaredButUncreatedColumns(result)).toMatch(/GREEN|no drift/i);
  });

  it('counts columns created inside a CREATE TABLE body (the bootstrap path), not just ALTER ADD COLUMN', () => {
    // FarmSettings.farmName is created by the bootstrap CREATE TABLE body.
    // A naive "only parse ADD COLUMN" check would false-positive here and
    // jam the pipeline — this is the #280 false-positive risk.
    const prisma = `
model FarmSettings {
  id       String @id
  farmName String @default("My Farm")
}
`;
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: BOOTSTRAP_FULL,
      migrations: [],
    });
    expect(result).toEqual([]);
  });

  it('does NOT false-positive on relation fields, array fields, or @relation', () => {
    // mob (relation), observations (array relation) are NOT columns. Only
    // mobId (scalar FK) is a real column — and the bootstrap creates it.
    const prisma = `
model Animal {
  id           String        @id
  mobId        String?
  mob          Mob?          @relation(fields: [mobId], references: [id])
  observations Observation[]
}
model Mob {
  id      String   @id
  animals Animal[]
}
model Observation {
  id       String  @id
  animalId String?
  animal   Animal? @relation(fields: [animalId], references: [id])
}
`;
    const bootstrap = `
CREATE TABLE "Animal" ( "id" TEXT NOT NULL PRIMARY KEY, "mobId" TEXT );
CREATE TABLE "Mob" ( "id" TEXT NOT NULL PRIMARY KEY );
CREATE TABLE "Observation" ( "id" TEXT NOT NULL PRIMARY KEY, "animalId" TEXT );
`;
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: bootstrap,
      migrations: [],
    });
    // No drift: relation/array fields are not columns; mobId & animalId are
    // created by the bootstrap bodies.
    expect(result).toEqual([]);
  });

  it('respects @map / @@map (column + table name rewrites) on both Prisma and DDL sides', () => {
    const prisma = `
model FarmSpeciesSettings {
  id          String @id
  thresholdHr Int    @map("threshold_hours")
  @@map("farm_species_settings")
}
`;
    // DDL uses the mapped table + column names.
    const bootstrap = `
CREATE TABLE "farm_species_settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "threshold_hours" INTEGER NOT NULL DEFAULT 48
);
`;
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: bootstrap,
      migrations: [],
    });
    expect(result).toEqual([]);
  });

  it('flags the @map case when the mapped column is genuinely uncreated', () => {
    const prisma = `
model FarmSpeciesSettings {
  id          String @id
  thresholdHr Int    @map("threshold_hours")
  @@map("farm_species_settings")
}
`;
    const bootstrap = `
CREATE TABLE "farm_species_settings" ( "id" TEXT NOT NULL PRIMARY KEY );
`;
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: bootstrap,
      migrations: [],
    });
    expect(result).toEqual([
      { table: 'farm_species_settings', column: 'threshold_hours' },
    ]);
  });

  it('treats enum-typed fields as TEXT columns (must be created by DDL)', () => {
    const prisma = `
enum Role {
  admin
  viewer
}
model User {
  id   String @id
  role Role   @default(viewer)
}
`;
    const bootstrap = `CREATE TABLE "User" ( "id" TEXT NOT NULL PRIMARY KEY, "role" TEXT NOT NULL DEFAULT 'viewer' );`;
    expect(
      computeDeclaredButUncreatedColumns({
        prismaSchemaSrc: prisma,
        bootstrapDdl: bootstrap,
        migrations: [],
      }),
    ).toEqual([]);

    // Same schema but DDL omits the enum column → flagged.
    const bootstrapMissing = `CREATE TABLE "User" ( "id" TEXT NOT NULL PRIMARY KEY );`;
    expect(
      computeDeclaredButUncreatedColumns({
        prismaSchemaSrc: prisma,
        bootstrapDdl: bootstrapMissing,
        migrations: [],
      }),
    ).toEqual([{ table: 'User', column: 'role' }]);
  });

  it('handles quoted/unquoted identifiers, IF NOT EXISTS, and SQL-keyword table names in DDL', () => {
    const prisma = `
model Transaction {
  id       String @id
  isForeign Boolean @default(false)
}
`;
    // CREATE TABLE IF NOT EXISTS, unquoted id, then a later ADD COLUMN with
    // quoted keyword table name. Both must be recognised.
    const bootstrap = `CREATE TABLE IF NOT EXISTS "Transaction" ( id TEXT NOT NULL PRIMARY KEY );`;
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: bootstrap,
      migrations: [
        {
          name: '0007_transaction_is_foreign.sql',
          sql: `ALTER TABLE "Transaction" ADD COLUMN "isForeign" BOOLEAN NOT NULL DEFAULT false;`,
        },
      ],
    });
    expect(result).toEqual([]);
  });

  it('ignores -- line comments narrating DDL that is not actually executed', () => {
    const prisma = `
model Animal {
  id      String @id
  species String @default("cattle")
}
`;
    // The migration only *describes* an ADD COLUMN in a comment; it does
    // not execute it. species is genuinely uncreated → must still flag.
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: `CREATE TABLE "Animal" ( "id" TEXT NOT NULL PRIMARY KEY );`,
      migrations: [
        {
          name: '0099_doc_only.sql',
          sql: `-- this file used to: ALTER TABLE "Animal" ADD COLUMN "species" TEXT;\nSELECT 1;`,
        },
      ],
    });
    expect(result).toEqual([{ table: 'Animal', column: 'species' }]);
  });

  it('aggregates and sorts multiple offenders deterministically', () => {
    const prisma = `
model Animal {
  id  String @id
  bbb String?
  aaa String?
}
model FarmSettings {
  id   String @id
  zzz  String?
}
`;
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: `
CREATE TABLE "Animal" ( "id" TEXT NOT NULL PRIMARY KEY );
CREATE TABLE "FarmSettings" ( "id" TEXT NOT NULL PRIMARY KEY );
`,
      migrations: [],
    });
    expect(result).toEqual([
      { table: 'Animal', column: 'aaa' },
      { table: 'Animal', column: 'bbb' },
      { table: 'FarmSettings', column: 'zzz' },
    ]);
  });

  it('does not flag a Prisma model whose table is entirely absent from DDL (separate drift class, not our job here)', () => {
    // A model with NO backing table at all is a "missing table" concern,
    // surfaced by the per-tenant arm. The static declared-but-uncreated
    // guard is column-granular and should not double-report every column
    // of an unbacked model as noise. It reports the table once.
    const prisma = `
model BrandNewModel {
  id   String @id
  name String
}
`;
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: `CREATE TABLE "Animal" ( "id" TEXT NOT NULL PRIMARY KEY );`,
      migrations: [],
    });
    // Whole table missing → report once as table-level, not one row per col.
    expect(result).toEqual([
      { table: 'BrandNewModel', column: '*' },
    ]);
    expect(formatDeclaredButUncreatedColumns(result)).toMatch(
      /BrandNewModel\.\*|BrandNewModel \(table/,
    );
  });
});

// ─── the ratchet: frozen legacy baseline subtraction ────────────────────────
//
// lib/farm-schema.ts FARM_SCHEMA_SQL is historically incomplete vs
// prisma/schema.prisma (61 declared-but-uncreated entries from the legacy
// `prisma db push` era). Failing on that whole backlog would jam the
// prod-promote pipeline repo-wide (the #280 incident). The guard subtracts a
// frozen baseline so it only fails on NEW regressions. These tests lock the
// ratchet semantics and — critically — that the guard is GREEN against the
// real current schema (per feedback-gate-must-validate-real-pr.md item 5:
// any gate comparing against an external truth must self-validate the real
// PR scenario, or it fails by construction).

describe('declared-but-uncreated guard — frozen legacy baseline (ratchet)', () => {
  it('grandfathers a baselined column.column entry (no failure)', () => {
    const prisma = `
model Task {
  id        String  @id
  taskType  String?
}
`;
    // Task.taskType IS in LEGACY_DECLARED_BUT_UNCREATED_BASELINE.
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: `CREATE TABLE "Task" ( "id" TEXT NOT NULL PRIMARY KEY );`,
      migrations: [],
      baseline: LEGACY_DECLARED_BUT_UNCREATED_BASELINE,
    });
    expect(result).toEqual([]);
  });

  it('grandfathers an entire table via a `Table.*` baseline entry', () => {
    const prisma = `
model VeldAssessment {
  id     String @id
  score  Int
  notes  String?
}
`;
    // VeldAssessment.* is baselined → none of its columns fail.
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: `CREATE TABLE "Animal" ( "id" TEXT NOT NULL PRIMARY KEY );`,
      migrations: [],
      baseline: LEGACY_DECLARED_BUT_UNCREATED_BASELINE,
    });
    expect(result).toEqual([]);
  });

  it('STILL fails on a NEW uncreated column even when other baselined ones exist (the regression class — acceptance #1)', () => {
    const prisma = `
model Task {
  id          String  @id
  taskType    String?
  brandNewCol String?
}
`;
    // taskType is baselined; brandNewCol is NOT → only brandNewCol fails.
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: `CREATE TABLE "Task" ( "id" TEXT NOT NULL PRIMARY KEY );`,
      migrations: [],
      baseline: LEGACY_DECLARED_BUT_UNCREATED_BASELINE,
    });
    expect(result).toEqual([{ table: 'Task', column: 'brandNewCol' }]);
    expect(formatDeclaredButUncreatedColumns(result)).toMatch(/Task\.brandNewCol/);
  });

  it('a baselined column stops failing once a migration genuinely creates it (ratchet shrinks safely — acceptance #2)', () => {
    const prisma = `
model Task {
  id       String  @id
  taskType String?
}
`;
    // Even though Task.taskType is baselined, adding the migration is the
    // real fix; result stays empty (no double-count, no regression).
    const result = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc: prisma,
      bootstrapDdl: `CREATE TABLE "Task" ( "id" TEXT NOT NULL PRIMARY KEY );`,
      migrations: [
        { name: '0099_task_type.sql', sql: `ALTER TABLE "Task" ADD COLUMN "taskType" TEXT;` },
      ],
      baseline: LEGACY_DECLARED_BUT_UNCREATED_BASELINE,
    });
    expect(result).toEqual([]);
  });
});

describe('declared-but-uncreated guard — REAL schema self-validation (#280 jam prevention)', () => {
  it('is GREEN against the real prisma/schema.prisma + FARM_SCHEMA_SQL + migrations/ with the frozen baseline', async () => {
    // THE locking test. If this ever fails, either (a) a new
    // declared-but-uncreated column was introduced (fix: add a migration —
    // do NOT just append to the baseline) or (b) a baselined column was
    // genuinely created and the bootstrap/migrations now cover it (safe to
    // remove that baseline entry). It must NEVER be "just append to the
    // baseline to make CI pass" — that re-opens the #280 regression class.
    const root = process.cwd();
    const prismaSchemaSrc = await readFile(
      join(root, 'prisma/schema.prisma'),
      'utf-8',
    );
    const dir = join(root, 'migrations');
    const files = (await readdir(dir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const migrations: { name: string; sql: string }[] = [];
    for (const name of files) {
      migrations.push({ name, sql: await readFile(join(dir, name), 'utf-8') });
    }
    const missing = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc,
      bootstrapDdl: FARM_SCHEMA_SQL,
      migrations,
      baseline: LEGACY_DECLARED_BUT_UNCREATED_BASELINE,
    });
    if (missing.length > 0) {
      // Surface the offenders so a failing run is self-diagnosing.
      console.error(formatDeclaredButUncreatedColumns(missing));
    }
    expect(missing).toEqual([]);
  });

  it('the frozen baseline has no entry the real schema+DDL already satisfies (keeps the ratchet honest — stale entries are dead weight)', async () => {
    // A baseline entry that is NOT actually missing means the ratchet is
    // carrying dead weight and could mask a real future regression on that
    // exact table.column. This catches drift in the OTHER direction.
    const root = process.cwd();
    const prismaSchemaSrc = await readFile(
      join(root, 'prisma/schema.prisma'),
      'utf-8',
    );
    const dir = join(root, 'migrations');
    const files = (await readdir(dir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const migrations: { name: string; sql: string }[] = [];
    for (const name of files) {
      migrations.push({ name, sql: await readFile(join(dir, name), 'utf-8') });
    }
    // Raw diff (no baseline) = the full set the baseline is allowed to cover.
    const rawMissing = computeDeclaredButUncreatedColumns({
      prismaSchemaSrc,
      bootstrapDdl: FARM_SCHEMA_SQL,
      migrations,
    });
    const rawSet = new Set(rawMissing.map((m) => `${m.table}.${m.column}`));
    const staleBaseline = LEGACY_DECLARED_BUT_UNCREATED_BASELINE.filter(
      (entry) => !rawSet.has(entry),
    );
    expect(staleBaseline).toEqual([]);
  });
});
