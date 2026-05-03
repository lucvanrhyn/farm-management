/**
 * One-off: count rows in each table on audit/test tenants to see if they hold
 * any data we'd need to preserve before a destructive backfill.
 */
import { createClient, type Client } from '@libsql/client';
import { getFarmCreds } from '../../lib/meta-db';

const TENANTS = ['audit-farm', 'audit-test-farm', 'test-farm'];

async function counts(db: Client): Promise<Record<string, number>> {
  const tables = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%'`,
  );
  const out: Record<string, number> = {};
  for (const row of tables.rows) {
    const name = row.name as string;
    try {
      const c = await db.execute(`SELECT COUNT(*) as n FROM "${name}"`);
      out[name] = Number(c.rows[0]?.n ?? 0);
    } catch (err) {
      out[name] = -1;
    }
  }
  return out;
}

async function main() {
  for (const slug of TENANTS) {
    console.log(`\n=== ${slug} ===`);
    const creds = await getFarmCreds(slug);
    if (!creds) {
      console.log(`  no creds`);
      continue;
    }
    const db = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
    try {
      const c = await counts(db);
      const nonEmpty = Object.entries(c).filter(([, n]) => n > 0);
      const total = Object.values(c).reduce((a, b) => a + Math.max(0, b), 0);
      console.log(`  total rows: ${total}`);
      if (nonEmpty.length === 0) {
        console.log(`  all empty`);
      } else {
        for (const [name, n] of nonEmpty) console.log(`  ${name}: ${n}`);
      }
    } finally {
      db.close();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
