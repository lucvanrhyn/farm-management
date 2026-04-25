import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { revalidateObservationWrite } from "@/lib/server/revalidate";
import { checkRateLimit } from "@/lib/rate-limit";

// Allowlist of valid observation type strings to prevent arbitrary type injection
const VALID_OBSERVATION_TYPES = new Set([
  "camp_condition",
  "camp_check",
  "calving",
  "pregnancy_scan",
  "weighing",
  "treatment",
  "heat_detection",
  "insemination",
  "drying_off",
  "weaning",
  "death",
  "mob_movement",
  "general",
  "dosing",
  "shearing",
  "lambing",
  "game_census",
  "game_sighting",
]);

export async function GET(request: NextRequest) {
  const ctx = await getFarmContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma } = ctx;

  const { searchParams } = new URL(request.url);
  const camp = searchParams.get("camp");
  const type = searchParams.get("type");
  const animalId = searchParams.get("animalId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const where: Record<string, unknown> = {};
  if (camp) where.campId = camp;
  if (type) where.type = type;
  if (animalId) where.animalId = animalId;

  try {
    const observations = await prisma.observation.findMany({
      where,
      orderBy: { observedAt: "desc" },
      take: limit,
      skip: offset,
    });
    return NextResponse.json(observations);
  } catch (err) {
    console.error("[observations GET] DB error:", err);
    return NextResponse.json({ error: "Failed to fetch observations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await getFarmContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, session, slug } = ctx;

  // Rate limit: 100 observations per minute per user (offline sync can burst, but cap runaway clients)
  const userId = session.user?.email ?? "unknown";
  const rl = checkRateLimit(`observations:${userId}`, 100, 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await request.json();
  const { type, camp_id, animal_id, details, created_at } = body;

  if (!type || !camp_id) {
    return NextResponse.json(
      { error: "Missing required fields: type and camp_id" },
      { status: 400 }
    );
  }

  // Validate type against allowlist to prevent arbitrary type injection
  if (!VALID_OBSERVATION_TYPES.has(type)) {
    return NextResponse.json(
      { error: `Invalid observation type: ${type}` },
      { status: 400 }
    );
  }

  // Verify camp_id belongs to this farm's DB (prevents writing to arbitrary camps)
  const campExists = await prisma.camp.findUnique({ where: { campId: camp_id }, select: { campId: true } });
  if (!campExists) {
    return NextResponse.json({ error: "Camp not found" }, { status: 404 });
  }

  const observedAt = created_at ? new Date(created_at) : new Date();
  if (isNaN(observedAt.getTime())) {
    return NextResponse.json(
      { error: "Invalid created_at timestamp" },
      { status: 400 }
    );
  }

  // Phase I.3 — denormalise species onto Observation at write time so
  // /admin/reproduction can filter `species: mode` directly (no animalId-IN
  // prefetch). Nullable: orphan/camp-only observations simply have no species.
  let species: string | null = null;
  if (animal_id) {
    const animal = await prisma.animal.findUnique({
      where: { animalId: animal_id },
      select: { species: true },
    });
    species = animal?.species ?? null;
  }

  try {
    const record = await prisma.observation.create({
      data: {
        type,
        campId: camp_id,
        animalId: animal_id ?? null,
        details: details ?? "",
        observedAt,
        loggedBy: session.user?.email ?? null,
        species,
      },
    });
    revalidateObservationWrite(slug);
    return NextResponse.json({ success: true, id: record.id });
  } catch (err) {
    console.error("[observations] DB error:", err);
    return NextResponse.json({ error: "Failed to save observation" }, { status: 500 });
  }
}
