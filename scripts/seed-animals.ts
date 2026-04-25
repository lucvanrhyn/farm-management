/**
 * One-time script: reads animals.xlsx from project root and upserts all rows into Prisma.
 * Safe to re-run (upsert by animalId).
 * Run with: pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/seed-animals.ts
 */

import path from "path";
import { PrismaClient } from "@prisma/client";
import { readWorkbookFile, readFirstSheetAsObjects } from "../lib/xlsx-shim";

const prisma = new PrismaClient();

const REQUIRED_COLUMNS = ["animal_id", "sex", "category", "current_camp"];
const VALID_CATEGORIES = new Set(["Cow", "Bull", "Heifer", "Calf", "Ox"]);
const VALID_SEXES = new Set(["Male", "Female"]);
const VALID_STATUSES = new Set(["Active", "Sold", "Deceased"]);

async function main() {
  const filePath = path.join(process.cwd(), "animals.xlsx");
  console.log(`Reading ${filePath}…`);

  const workbook = await readWorkbookFile(filePath);
  const rows = readFirstSheetAsObjects(workbook, { defval: "" }) as Record<string, string>[];

  if (rows.length === 0) {
    console.error("File is empty — aborting.");
    process.exit(1);
  }

  // Validate required columns
  const headers = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    console.error(`Missing required columns: ${missing.join(", ")}`);
    process.exit(1);
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const animalId = String(row.animal_id ?? "").trim();
    if (!animalId) { errors.push(`Row ${rowNum}: missing animal_id`); skipped++; continue; }

    const sex = String(row.sex ?? "").trim();
    if (!VALID_SEXES.has(sex)) { errors.push(`Row ${rowNum} (${animalId}): invalid sex "${sex}"`); skipped++; continue; }

    const category = String(row.category ?? "").trim();
    if (!VALID_CATEGORIES.has(category)) { errors.push(`Row ${rowNum} (${animalId}): invalid category "${category}"`); skipped++; continue; }

    const currentCamp = String(row.current_camp ?? "").trim();
    if (!currentCamp) { errors.push(`Row ${rowNum} (${animalId}): missing current_camp`); skipped++; continue; }

    const status = String(row.status ?? "Active").trim();
    const resolvedStatus = VALID_STATUSES.has(status) ? status : "Active";

    try {
      await prisma.animal.upsert({
        where: { animalId },
        update: {
          name: String(row.name ?? "").trim() || null,
          sex,
          dateOfBirth: String(row.date_of_birth ?? "").trim() || null,
          breed: String(row.breed ?? "Brangus").trim() || "Brangus",
          category,
          currentCamp,
          status: resolvedStatus,
          motherId: String(row.mother_id ?? "").trim() || null,
          fatherId: String(row.father_id ?? "").trim() || null,

          dateAdded: String(row.date_added ?? "").trim() || new Date().toISOString().split("T")[0],
        },
        create: {
          animalId,
          name: String(row.name ?? "").trim() || null,
          sex,
          dateOfBirth: String(row.date_of_birth ?? "").trim() || null,
          breed: String(row.breed ?? "Brangus").trim() || "Brangus",
          category,
          currentCamp,
          status: resolvedStatus,
          motherId: String(row.mother_id ?? "").trim() || null,
          fatherId: String(row.father_id ?? "").trim() || null,

          dateAdded: String(row.date_added ?? "").trim() || new Date().toISOString().split("T")[0],
        },
      });
      imported++;
    } catch (err) {
      errors.push(`Row ${rowNum} (${animalId}): ${String(err)}`);
      skipped++;
    }
  }

  console.log(`\n✅ Imported: ${imported}  |  Skipped: ${skipped}`);
  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach((e) => console.log("  •", e));
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
