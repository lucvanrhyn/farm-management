import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

const REQUIRED_COLUMNS = ["animal_id", "sex", "category", "current_camp"];

const VALID_CATEGORIES = new Set(["Cow", "Bull", "Heifer", "Calf", "Ox"]);
const VALID_SEXES = new Set(["Male", "Female"]);
const VALID_STATUSES = new Set(["Active", "Sold", "Deceased"]);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const allowedTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
  ];
  if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
    return NextResponse.json({ error: "File must be .xlsx, .xls, or .csv" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });

  if (rows.length === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }

  // Validate required columns
  const headers = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required columns: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed, +1 for header

    const animalId = String(row.animal_id ?? "").trim();
    if (!animalId) {
      errors.push(`Row ${rowNum}: missing animal_id`);
      skipped++;
      continue;
    }

    const sex = String(row.sex ?? "").trim();
    if (!VALID_SEXES.has(sex)) {
      errors.push(`Row ${rowNum} (${animalId}): invalid sex "${sex}" — must be Male or Female`);
      skipped++;
      continue;
    }

    const category = String(row.category ?? "").trim();
    if (!VALID_CATEGORIES.has(category)) {
      errors.push(`Row ${rowNum} (${animalId}): invalid category "${category}"`);
      skipped++;
      continue;
    }

    const currentCamp = String(row.current_camp ?? "").trim();
    if (!currentCamp) {
      errors.push(`Row ${rowNum} (${animalId}): missing current_camp`);
      skipped++;
      continue;
    }

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
          notes: String(row.notes ?? "").trim() || null,
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
          notes: String(row.notes ?? "").trim() || null,
          dateAdded: String(row.date_added ?? "").trim() || new Date().toISOString().split("T")[0],
        },
      });
      imported++;
    } catch (err) {
      errors.push(`Row ${rowNum} (${animalId}): DB error — ${String(err)}`);
      skipped++;
    }
  }

  return NextResponse.json({ imported, skipped, errors }, { status: 200 });
}
