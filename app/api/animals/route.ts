import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { revalidatePath } from "next/cache";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { searchParams } = new URL(req.url);
  const camp = searchParams.get("camp");
  const category = searchParams.get("category");
  const status = searchParams.get("status") ?? "Active";
  const species = searchParams.get("species");

  const animals = await prisma.animal.findMany({
    where: {
      ...(camp ? { currentCamp: camp } : {}),
      ...(category ? { category } : {}),
      ...(status !== "all" ? { status } : {}),
      ...(species ? { species } : {}),
    },
    orderBy: [{ category: "asc" }, { animalId: "asc" }],
  });

  return NextResponse.json(animals);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  // LOGGER role may create calf records (calving observation flow). ADMIN required for all else.
  if (role !== "ADMIN" && role !== "LOGGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { animalId, name, sex, dateOfBirth, breed, category, currentCamp, status, motherId, fatherId, species } = body;

  if (!animalId || !sex || !category || !currentCamp) {
    return NextResponse.json({ error: "Missing required fields: animalId, sex, category, currentCamp" }, { status: 400 });
  }

  // Validate field types and values
  const VALID_SPECIES = ["cattle", "sheep", "game"] as const;
  const VALID_SEX = ["Male", "Female"] as const;
  const VALID_STATUS = ["Active", "Sold", "Dead", "Removed"] as const;

  if (typeof animalId !== "string" || animalId.length > 50) {
    return NextResponse.json({ error: "Invalid animalId" }, { status: 400 });
  }
  if (!(VALID_SEX as readonly string[]).includes(sex)) {
    return NextResponse.json({ error: "Invalid sex" }, { status: 400 });
  }
  if (typeof category !== "string" || category.length > 50) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (species && !(VALID_SPECIES as readonly string[]).includes(species)) {
    return NextResponse.json({ error: "Invalid species" }, { status: 400 });
  }
  if (status && !(VALID_STATUS as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (dateOfBirth && (typeof dateOfBirth !== "string" || isNaN(Date.parse(dateOfBirth)))) {
    return NextResponse.json({ error: "Invalid dateOfBirth" }, { status: 400 });
  }

  const animal = await prisma.animal.create({
    data: {
      animalId,
      name: name ?? null,
      sex,
      dateOfBirth: dateOfBirth ?? null,
      breed: breed ?? "Brangus",
      category,
      currentCamp,
      status: status ?? "Active",
      motherId: motherId ?? null,
      fatherId: fatherId ?? null,
      species: species ?? "cattle",
      dateAdded: new Date().toISOString().split("T")[0],
    },
  });

  revalidatePath('/admin');
  revalidatePath('/admin/animals');
  revalidatePath('/admin/grafieke');
  revalidatePath('/dashboard');
  return NextResponse.json({ success: true, animal }, { status: 201 });
}
