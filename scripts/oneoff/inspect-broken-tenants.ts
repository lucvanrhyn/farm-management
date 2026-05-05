/**
 * One-off: inspect schema state of audit/test tenants that fail post-merge promote.
 *
 * Run with:
 *   pnpm dotenv-cli -e .env.local -- tsx scripts/oneoff/inspect-broken-tenants.ts
 */
import { createClient } from '@libsql/client';
import { getFarmCreds } from '../../lib/meta-db';

const TENANTS = ['audit-farm', 'audit-test-farm', 'test-farm', 'acme-cattle'];

async function main() {
  for (const slug of TENANTS) {
    console.log(`\n=== ${slug} ===`);
    const creds = await getFarmCreds(slug);
    if (!creds) {
      console.log(`  no creds in meta-db`);
      continue;
    }
    const db = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
    try {
      const tables = await db.execute(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      );
      const tableNames = tables.rows.map((r) => r.name as string);
      console.log(`  tables (${tableNames.length}):`, tableNames.join(', '));

      const hasMigrationsTable = tableNames.includes('_migrations');
      if (hasMigrationsTable) {
        const m = await db.execute(`SELECT name FROM "_migrations" ORDER BY name`);
        console.log(
          `  _migrations (${m.rows.length}):`,
          m.rows.map((r) => r.name as string).join(', ') || '<empty>',
        );
      } else {
        console.log(`  _migrations: <table missing>`);
      }
    } catch (err) {
      console.error(`  ERROR:`, err instanceof Error ? err.message : err);
    } finally {
      db.close();
    }
  }
}

main().catch((err) => {
  console.error('crashed:', err);
  process.exit(1);
});
