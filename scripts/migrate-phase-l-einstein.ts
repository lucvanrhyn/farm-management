/**
 * migrate-phase-l-einstein.ts — Phase L Wave 4 tenant migration for Farm Einstein
 *
 * Source-of-truth research: memory/research-phase-l-farm-einstein.md
 *   - Scope-C: libSQL native vector on Turso, OpenAI text-embedding-3-small (1536d),
 *     Haiku planner → Sonnet 4.6 answer, Farm Methodology Object in FarmSettings.aiSettings.
 *
 * Idempotently applies on delta-livestock + acme-cattle:
 *
 *   1. Create "EinsteinChunk" table — embedding stored as F32_BLOB(1536)
 *      (libSQL native fixed-size float32 vector type). Required to participate
 *      in libsql_vector_idx.
 *
 *        Columns (matches prisma/schema.prisma:789-804):
 *          id              TEXT PRIMARY KEY
 *          entityType      TEXT
 *          entityId        TEXT
 *          langTag         TEXT DEFAULT 'en'
 *          text            TEXT
 *          embedding       F32_BLOB(1536)
 *          tokensUsed      INTEGER
 *          modelId         TEXT
 *          sourceUpdatedAt DATETIME
 *          createdAt       DATETIME DEFAULT CURRENT_TIMESTAMP
 *
 *      Indices:
 *          einstein_chunk_entity_lang   UNIQUE(entityType, entityId, langTag)
 *          idx_einstein_chunk_entity    (entityType, entityId)
 *          idx_einstein_chunk_stale     (sourceUpdatedAt)
 *          idx_einstein_chunk_vec       libsql_vector_idx(embedding)   ← native ANN cosine
 *
 *   2. Create "RagQueryLog" table — append-only audit + billing log for every
 *      Einstein question (matches prisma/schema.prisma:811-833).
 *
 *      Indices:
 *          idx_rag_query_user_date  (userId, createdAt)
 *          idx_rag_query_date       (createdAt)
 *
 *   3. Extend "FarmSettings" with:
 *          + aiSettings TEXT    — JSON blob (assistantName, responseLanguage,
 *                                 methodology, ragConfig, learnedPreferences).
 *                                 Single source of truth managed by
 *                                 lib/einstein/settings-schema.ts.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. ALTER
 * TABLE ADD COLUMN is gated by PRAGMA table_info (SQLite has no IF NOT EXISTS
 * on ALTER). Safe to re-run.
 *
 * Safety: if EinsteinChunk already exists WITHOUT F32_BLOB(1536) typing (e.g.
 * a rogue `prisma db push` created it as plain BLOB), the script fails loud
 * rather than silently leaving the table unable to participate in the vector
 * index. Recovery: drop the table manually, then re-run this script.
 *
 * Scope: hard-coded to delta-livestock + acme-cattle per the Wave 4 plan.
 * Safer than iterating getAllFarmSlugs() — protects against accidentally hitting
 * a tenant that was provisioned after Wave 4 with Einstein already baked in.
 *
 * Exits nonzero if ANY tenant fails. This is infrastructure — partial
 * application would leave Wave 2's Inngest ingestion functions writing to
 * tables that don't exist on some tenants.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-phase-l-einstein.ts
 */

import { createClient, type Client } from '@libsql/client';
import { getFarmCreds } from '../lib/meta-db';

const TARGET_SLUGS: ReadonlyArray<string> = ['delta-livestock', 'acme-cattle'];

// ── DDL ────────────────────────────────────────────────────────────────────

const CREATE_EINSTEIN_CHUNK = `
CREATE TABLE IF NOT EXISTS "EinsteinChunk" (
  "id"              TEXT PRIMARY KEY NOT NULL,
  "entityType"      TEXT NOT NULL,
  "entityId"        TEXT NOT NULL,
  "langTag"         TEXT NOT NULL DEFAULT 'en',
  "text"            TEXT NOT NULL,
  "embedding"       F32_BLOB(1536) NOT NULL,
  "tokensUsed"      INTEGER NOT NULL,
  "modelId"         TEXT NOT NULL,
  "sourceUpdatedAt" DATETIME NOT NULL,
  "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)
`;

const EINSTEIN_CHUNK_INDICES: ReadonlyArray<string> = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "einstein_chunk_entity_lang"
     ON "EinsteinChunk"("entityType", "entityId", "langTag")`,
  `CREATE INDEX IF NOT EXISTS "idx_einstein_chunk_entity"
     ON "EinsteinChunk"("entityType", "entityId")`,
  `CREATE INDEX IF NOT EXISTS "idx_einstein_chunk_stale"
     ON "EinsteinChunk"("sourceUpdatedAt")`,
  // libSQL native ANN index. Cosine metric is the default and matches
  // vector_distance_cos() in lib/einstein/retriever.ts. Requires the column
  // to be typed F32_BLOB(N) — plain BLOB will fail at CREATE INDEX time.
  `CREATE INDEX IF NOT EXISTS "idx_einstein_chunk_vec"
     ON "EinsteinChunk"(libsql_vector_idx(embedding))`,
];

const CREATE_RAG_QUERY_LOG = `
CREATE TABLE IF NOT EXISTS "RagQueryLog" (
  "id"                 TEXT PRIMARY KEY NOT NULL,
  "userId"             TEXT NOT NULL,
  "assistantName"      TEXT NOT NULL,
  "question"           TEXT NOT NULL,
  "answerText"         TEXT,
  "citations"          TEXT NOT NULL,
  "retrievalLatencyMs" INTEGER NOT NULL,
  "answerLatencyMs"    INTEGER NOT NULL,
  "inputTokens"        INTEGER NOT NULL,
  "outputTokens"       INTEGER NOT NULL,
  "cachedInputTokens"  INTEGER NOT NULL DEFAULT 0,
  "costZar"            REAL NOT NULL,
  "modelId"            TEXT NOT NULL,
  "feedback"           TEXT,
  "feedbackNote"       TEXT,
  "errorCode"          TEXT,
  "refusedReason"      TEXT,
  "createdAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)
`;

const RAG_QUERY_LOG_INDICES: ReadonlyArray<string> = [
  `CREATE INDEX IF NOT EXISTS "idx_rag_query_user_date"
     ON "RagQueryLog"("userId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "idx_rag_query_date"
     ON "RagQueryLog"("createdAt")`,
];

const ADD_FARM_SETTINGS_COLUMNS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: 'aiSettings', sql: `ALTER TABLE "FarmSettings" ADD COLUMN "aiSettings" TEXT` },
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function tableExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return res.rows.length > 0;
}

async function indexExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
    args: [name],
  });
  return res.rows.length > 0;
}

async function columnExists(db: Client, table: string, name: string): Promise<boolean> {
  const info = await db.execute(`PRAGMA table_info("${table}")`);
  return info.rows.some((row) => row.name === name);
}

/**
 * Return the raw CREATE TABLE SQL for a table, so we can sanity-check that
 * EinsteinChunk.embedding is typed as F32_BLOB(1536) when the table pre-exists.
 */
async function getTableCreateSql(db: Client, name: string): Promise<string | null> {
  const res = await db.execute({
    sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  if (res.rows.length === 0) return null;
  const raw = res.rows[0].sql;
  return typeof raw === 'string' ? raw : null;
}

async function addColumnsIfMissing(
  db: Client,
  table: string,
  columns: ReadonlyArray<{ name: string; sql: string }>,
  addedLog: string[],
): Promise<void> {
  for (const col of columns) {
    if (!(await columnExists(db, table, col.name))) {
      await db.execute(col.sql);
      addedLog.push(`${table}.${col.name}`);
    }
  }
}

// ── Per-tenant migration ───────────────────────────────────────────────────

interface MigrationReport {
  createdTables: string[];
  createdIndices: string[];
  addedColumns: string[];
  skipped: string[];
}

async function migrateOne(slug: string): Promise<MigrationReport> {
  const creds = await getFarmCreds(slug);
  if (!creds) {
    throw new Error(`No creds for tenant "${slug}" — cannot migrate.`);
  }

  const db = createClient({
    url: creds.tursoUrl,
    authToken: creds.tursoAuthToken,
  });

  const report: MigrationReport = {
    createdTables: [],
    createdIndices: [],
    addedColumns: [],
    skipped: [],
  };

  try {
    // Guard: FarmSettings must exist (base-schema table). We rely on Luc to
    // have provisioned the tenant before Phase L.
    if (!(await tableExists(db, 'FarmSettings'))) {
      throw new Error(
        `FarmSettings table missing on "${slug}" — base schema not provisioned.`,
      );
    }

    // 1. EinsteinChunk
    const hadChunk = await tableExists(db, 'EinsteinChunk');
    if (hadChunk) {
      // Safety probe: if the table exists but embedding is not F32_BLOB(1536),
      // fail loud. Prisma's own db-push would create a plain BLOB, which
      // silently breaks libsql_vector_idx at index-creation time.
      const existingSql = await getTableCreateSql(db, 'EinsteinChunk');
      if (existingSql && !/F32_BLOB\s*\(\s*1536\s*\)/i.test(existingSql)) {
        throw new Error(
          `EinsteinChunk on "${slug}" exists without F32_BLOB(1536) typing. ` +
            `Drop the table manually and re-run this script. Current DDL:\n${existingSql}`,
        );
      }
      report.skipped.push('EinsteinChunk table');
    } else {
      await db.execute(CREATE_EINSTEIN_CHUNK);
      report.createdTables.push('EinsteinChunk');
    }

    for (const sql of EINSTEIN_CHUNK_INDICES) {
      // Extract index name from the SQL for reporting (between first pair of double-quotes)
      const match = sql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "([^"]+)"/i);
      const idxName = match?.[1] ?? '<unknown>';
      const had = await indexExists(db, idxName);
      await db.execute(sql);
      if (!had) report.createdIndices.push(idxName);
    }

    // 2. RagQueryLog
    const hadLog = await tableExists(db, 'RagQueryLog');
    await db.execute(CREATE_RAG_QUERY_LOG);
    if (!hadLog) report.createdTables.push('RagQueryLog');
    else report.skipped.push('RagQueryLog table');

    for (const sql of RAG_QUERY_LOG_INDICES) {
      const match = sql.match(/CREATE INDEX IF NOT EXISTS "([^"]+)"/i);
      const idxName = match?.[1] ?? '<unknown>';
      const had = await indexExists(db, idxName);
      await db.execute(sql);
      if (!had) report.createdIndices.push(idxName);
    }

    // 3. FarmSettings.aiSettings
    await addColumnsIfMissing(db, 'FarmSettings', ADD_FARM_SETTINGS_COLUMNS, report.addedColumns);

    return report;
  } finally {
    db.close();
  }
}

// ── Verification ────────────────────────────────────────────────────────────

async function verifyOne(slug: string): Promise<void> {
  const creds = await getFarmCreds(slug);
  if (!creds) throw new Error(`No creds for "${slug}" to verify.`);

  const db = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
  try {
    const expectedTables = ['EinsteinChunk', 'RagQueryLog'];
    const expectedIndices = [
      'einstein_chunk_entity_lang',
      'idx_einstein_chunk_entity',
      'idx_einstein_chunk_stale',
      'idx_einstein_chunk_vec',
      'idx_rag_query_user_date',
      'idx_rag_query_date',
    ];

    for (const t of expectedTables) {
      if (!(await tableExists(db, t))) {
        throw new Error(`[${slug}] verify: table "${t}" missing after migration`);
      }
    }
    for (const i of expectedIndices) {
      if (!(await indexExists(db, i))) {
        throw new Error(`[${slug}] verify: index "${i}" missing after migration`);
      }
    }
    if (!(await columnExists(db, 'FarmSettings', 'aiSettings'))) {
      throw new Error(`[${slug}] verify: FarmSettings.aiSettings column missing`);
    }

    // Smoke test the vector index with a dummy query — confirms F32_BLOB + ANN are wired up.
    // Uses vector32(?) to build an empty 1536d zero vector inline. Returns 0 rows (table
    // is empty until backfill runs) but must not error.
    await db.execute({
      sql: `SELECT id FROM "EinsteinChunk"
            ORDER BY vector_distance_cos(embedding, vector32(?)) ASC
            LIMIT 1`,
      // 1536 zeros, little-endian f32 = 6144 zero bytes
      args: [Buffer.alloc(1536 * 4)],
    });

    console.log(`  [${slug}] verify ok — all 2 tables, 6 indices, 1 column present; vector probe returned without error`);
  } finally {
    db.close();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n-- Phase L Wave 4: Einstein migration (EinsteinChunk + RagQueryLog + FarmSettings.aiSettings) --\n');
  console.log(`Target tenants: ${TARGET_SLUGS.join(', ')}\n`);

  let failed = 0;

  for (const slug of TARGET_SLUGS) {
    try {
      const report = await migrateOne(slug);
      const parts = [
        report.createdTables.length > 0
          ? `created ${report.createdTables.join(', ')}`
          : 'no new tables',
        report.createdIndices.length > 0
          ? `created ${report.createdIndices.length} indices (${report.createdIndices.join(', ')})`
          : 'no new indices',
        report.addedColumns.length > 0
          ? `added ${report.addedColumns.join(', ')}`
          : 'no new columns',
        report.skipped.length > 0 ? `skipped ${report.skipped.join(', ')}` : null,
      ].filter(Boolean);
      console.log(`  [${slug}] ok — ${parts.join('; ')}`);
    } catch (err) {
      failed += 1;
      console.error(`  [${slug}] FAILED:`, err);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed}/${TARGET_SLUGS.length} tenant(s) failed. NOT running verification.`);
    process.exit(1);
  }

  console.log('\n-- Verification --\n');
  for (const slug of TARGET_SLUGS) {
    try {
      await verifyOne(slug);
    } catch (err) {
      failed += 1;
      console.error(`  [${slug}] VERIFY FAILED:`, err);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} verification(s) failed.`);
    process.exit(1);
  }

  console.log(`\nDone. ${TARGET_SLUGS.length} tenant(s) migrated & verified.`);
  console.log('Next: scripts/einstein-backfill-embeddings.ts (Wave 4 step 2).');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
