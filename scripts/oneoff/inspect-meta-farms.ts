/**
 * One-off: dump meta-db `farms` rows so we can confirm what audit-farm /
 * audit-test-farm / test-farm actually are before doing destructive work.
 */
import { createClient } from '@libsql/client';

async function main() {
  const url = process.env.META_TURSO_URL;
  const token = process.env.META_TURSO_AUTH_TOKEN;
  if (!url || !token) throw new Error('META_TURSO_URL / META_TURSO_AUTH_TOKEN required');
  const db = createClient({ url, authToken: token });
  const cols = await db.execute(`PRAGMA table_info(farms)`);
  console.log('cols:', cols.rows.map((c) => c.name).join(', '));
  const r = await db.execute(`SELECT * FROM farms ORDER BY slug`);
  for (const row of r.rows) {
    console.log(JSON.stringify(row));
  }
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
