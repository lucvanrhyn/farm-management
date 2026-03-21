import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForRequest } from "@/lib/farm-prisma";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";

const REQUIRED_COLUMNS = ["animal_id", "sex", "category", "current_camp"];

const VALID_STATUSES = new Set(["Active", "Sold", "Deceased"]);

// Normalize sex values — accept English and Afrikaans variants, any case
function normalizeSex(raw: string): "Male" | "Female" | null {
  const v = raw.trim().toLowerCase();
  if (["male", "m", "manlik", "manlike", "bul", "bull", "os", "ox"].includes(v)) return "Male";
  if (["female", "f", "vroulik", "vroulike", "koei", "vers", "kalf", "heifer", "cow", "calf"].includes(v)) return "Female";
  return null;
}

// Normalize category values — accept English and Afrikaans variants, any case
function normalizeCategory(raw: string): "Cow" | "Bull" | "Heifer" | "Calf" | "Ox" | null {
  const v = raw.trim().toLowerCase();
  if (["cow", "koei"].includes(v)) return "Cow";
  if (["bull", "bul", "bulle"].includes(v)) return "Bull";
  if (["heifer", "vers", "verset", "versie"].includes(v)) return "Heifer";
  if (["calf", "kalf", "kalfie", "kalwer"].includes(v)) return "Calf";
  if (["ox", "os", "osse"].includes(v)) return "Ox";
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaForRequest();
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

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

  const encoder = new TextEncoder();
  const total = rows.length;

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
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
        } else {
          const sex = normalizeSex(String(row.sex ?? ""));
          if (!sex) {
            errors.push(`Row ${rowNum} (${animalId}): invalid sex "${row.sex}" — expected Male/Female or Manlik/Vroulik`);
            skipped++;
          } else {
            const category = normalizeCategory(String(row.category ?? ""));
            if (!category) {
              errors.push(`Row ${rowNum} (${animalId}): invalid category "${row.category}" — expected Cow/Koei, Bull/Bul, Heifer/Vers, Calf/Kalf, or Ox/Os`);
              skipped++;
            } else {
              const currentCamp = String(row.current_camp ?? "").trim();
              if (!currentCamp) {
                errors.push(`Row ${rowNum} (${animalId}): missing current_camp`);
                skipped++;
              } else {
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
            }
          }
        }

        // Send progress every 25 rows or on the last row
        if ((i + 1) % 25 === 0 || i === rows.length - 1) {
          send({ processed: i + 1, total });
        }
      }

      send({ done: true, imported, skipped, errors });
      controller.close();

      if (imported > 0) {
        revalidatePath('/admin');
        revalidatePath('/admin/animals');
        revalidatePath('/admin/grafieke');
        revalidatePath('/dashboard');
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
