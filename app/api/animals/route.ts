import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const camp = searchParams.get("camp");
  const category = searchParams.get("category");
  const status = searchParams.get("status") ?? "Active";

  const animals = await prisma.animal.findMany({
    where: {
      ...(camp ? { currentCamp: camp } : {}),
      ...(category ? { category } : {}),
      ...(status !== "all" ? { status } : {}),
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

  const body = await req.json();
  const { animalId, name, sex, dateOfBirth, breed, category, currentCamp, status, motherId, fatherId, notes } = body;

  if (!animalId || !sex || !category || !currentCamp) {
    return NextResponse.json({ error: "Missing required fields: animalId, sex, category, currentCamp" }, { status: 400 });
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
      notes: notes ?? null,
      dateAdded: new Date().toISOString().split("T")[0],
    },
  });

  return NextResponse.json({ success: true, animal }, { status: 201 });
}
