import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { revalidateAnimalWrite } from "@/lib/server/revalidate";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma } = ctx;

  const { id } = await params;

  const animal = await prisma.animal.findUnique({
    where: { animalId: id },
  });

  if (!animal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(animal);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug } = ctx;

  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;

  // LOGGER role may only update the fields needed for field logging:
  // status + deceasedAt (death recording), currentCamp (movement recording).
  const LOGGER_ALLOWED = new Set(["status", "deceasedAt", "currentCamp"]);
  if (role === "LOGGER") {
    const hasDisallowedKeys = Object.keys(body).some((k) => !LOGGER_ALLOWED.has(k));
    if (hasDisallowedKeys) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const VALID_STATUS = new Set(["Active", "Deceased", "Sold", "Culled"]);
  const VALID_SEX = new Set(["Male", "Female", "Unknown"]);

  if ("status" in body && !VALID_STATUS.has(body.status as string)) {
    return NextResponse.json({ error: `status must be one of: ${[...VALID_STATUS].join(", ")}` }, { status: 400 });
  }
  if ("sex" in body && !VALID_SEX.has(body.sex as string)) {
    return NextResponse.json({ error: `sex must be one of: ${[...VALID_SEX].join(", ")}` }, { status: 400 });
  }

  const allowed = ["name", "sex", "dateOfBirth", "breed", "category", "currentCamp", "status", "motherId", "fatherId", "registrationNumber", "deceasedAt"];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  const animal = await prisma.animal.update({
    where: { animalId: id },
    data: update,
  });

  revalidateAnimalWrite(slug);
  return NextResponse.json(animal);
}
