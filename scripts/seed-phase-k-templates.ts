/**
 * seed-phase-k-templates.ts — Idempotent seed of the 20 SA-native task templates
 * per tenant. Mirrors POST /api/task-templates/install but runs against every
 * tenant directly via libSQL (no HTTP round-trip, no admin session required).
 *
 * Relies on the Phase K schema migration having already landed
 * (scripts/migrate-phase-k-tasks.ts) — the TaskTemplate table + unique index
 * (tenantSlug, name) must exist. Re-running is safe: existing rows are skipped
 * (INSERT OR IGNORE), new rows inserted.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-phase-k-templates.ts
 */

import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { getAllFarmSlugs, getFarmCreds } from "../lib/meta-db";
import { SEED_TEMPLATES } from "../lib/tasks/seed-templates";

async function seedOne(slug: string): Promise<{ inserted: number; skipped: number }> {
  const creds = await getFarmCreds(slug);
  if (!creds) {
    console.warn(`  [${slug}] no creds, skipping`);
    return { inserted: 0, skipped: 0 };
  }

  const db = createClient({ url: creds.tursoUrl, authToken: creds.tursoAuthToken });
  let inserted = 0;
  let skipped = 0;

  try {
    for (const t of SEED_TEMPLATES) {
      // INSERT OR IGNORE uses the (tenantSlug, name) unique index we created in
      // the Phase K migration. rowsAffected=0 when the row already exists.
      const res = await db.execute({
        sql: `INSERT OR IGNORE INTO "TaskTemplate"
                ("id", "tenantSlug", "name", "name_af", "taskType",
                 "description", "description_af", "priorityDefault",
                 "recurrenceRule", "reminderOffset", "species", "isPublic",
                 "createdAt", "updatedAt")
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        args: [
          randomUUID(),
          slug,
          t.name,
          t.name_af ?? null,
          t.taskType,
          t.description ?? null,
          t.description_af ?? null,
          t.priorityDefault ?? null,
          t.recurrenceRule ?? null,
          t.reminderOffset ?? null,
          t.species ?? null,
          t.isPublic === false ? 0 : 1,
        ],
      });
      if (Number(res.rowsAffected ?? 0) > 0) inserted += 1;
      else skipped += 1;
    }
    console.log(`  [${slug}] inserted ${inserted}, skipped ${skipped} (${SEED_TEMPLATES.length} total)`);
    return { inserted, skipped };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  console.log("\n-- Phase K template seed (20 SA-native task templates) --\n");
  const slugs = await getAllFarmSlugs();
  if (slugs.length === 0) {
    console.log("No farms found. Nothing to do.");
    return;
  }
  console.log(`Found ${slugs.length} farm(s): ${slugs.join(", ")}\n`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let failed = 0;
  for (const slug of slugs) {
    try {
      const r = await seedOne(slug);
      totalInserted += r.inserted;
      totalSkipped += r.skipped;
    } catch (err) {
      failed += 1;
      console.error(`  [${slug}] FAILED:`, err);
    }
  }

  console.log(
    `\nDone. ${totalInserted} inserted, ${totalSkipped} already present, ${failed} tenant(s) failed.`,
  );
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
