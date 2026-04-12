import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: 5 imports per hour per user — each import parses XLSX and bulk-upserts rows
  const userId = session.user?.email ?? "unknown";
  const rl = checkRateLimit(`import:${userId}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many import requests. Please wait before importing again." }, { status: 429 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  // Look up farm's default breed from settings
  const farmSettings = await prisma.farmSettings.findFirst({ select: { breed: true } });
  const defaultBreed = farmSettings?.breed?.trim() || "Mixed";

  // ── Process Camps sheet (if present) ───────────────────────────────────────
  let campsCreated = 0;
  const validCampIds = new Set<string>();

  if (workbook.SheetNames.includes("Camps")) {
    const campsSheet = workbook.Sheets["Camps"];
    const campRows = XLSX.utils.sheet_to_json<Record<string, string>>(campsSheet, { defval: "" });

    for (const campRow of campRows) {
      const campName = String(campRow.camp_name ?? "").trim();
      if (!campName) continue;

      const sizeRaw = String(campRow.size_hectares ?? "").trim();
      const sizeHectares = sizeRaw ? parseFloat(sizeRaw) : null;
      const waterSource = String(campRow.water_source ?? "").trim() || null;

      validCampIds.add(campName);

      const existing = await prisma.camp.findUnique({ where: { campId: campName } });
      if (!existing) {
        try {
          await prisma.camp.create({
            data: {
              campId: campName,
              campName,
              sizeHectares: sizeHectares !== null && !isNaN(sizeHectares) ? sizeHectares : null,
              waterSource,
            },
          });
          campsCreated++;
        } catch {
          // Camp may have been created concurrently — continue
        }
      }
    }
  }

  // Add all existing DB camps to the valid set (covers both new-format and old-format uploads)
  const existingCamps = await prisma.camp.findMany({ select: { campId: true, campName: true } });
  for (const camp of existingCamps) {
    validCampIds.add(camp.campId);
    validCampIds.add(camp.campName);
  }

  // ── Determine which sheet has animals ──────────────────────────────────────
  // Two-tab template: use "Animals" sheet. Single-sheet (legacy): use first sheet.
  const animalSheetName = workbook.SheetNames.includes("Animals")
    ? "Animals"
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[animalSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });

  if (rows.length === 0) {
    return NextResponse.json({ error: "Animals sheet is empty" }, { status: 400 });
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
  const hasCampValidation = validCampIds.size > 0;

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
              } else if (hasCampValidation && !validCampIds.has(currentCamp)) {
                errors.push(`Row ${rowNum} (${animalId}): camp "${currentCamp}" not found — create it in the Camps sheet or add it manually first`);
                skipped++;
              } else {
                const status = String(row.status ?? "Active").trim();
                const resolvedStatus = VALID_STATUSES.has(status) ? status : "Active";
                const breed = String(row.breed ?? "").trim() || defaultBreed;

                try {
                  await prisma.animal.upsert({
                    where: { animalId },
                    update: {
                      name: String(row.name ?? "").trim() || null,
                      sex,
                      dateOfBirth: String(row.date_of_birth ?? "").trim() || null,
                      breed,
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
                      breed,
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

      send({ done: true, imported, skipped, campsCreated, errors });
      controller.close();

      if (imported > 0 || campsCreated > 0) {
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
