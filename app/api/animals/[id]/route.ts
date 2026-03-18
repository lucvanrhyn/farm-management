import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const allowed = ["name", "sex", "dateOfBirth", "breed", "category", "currentCamp", "status", "motherId", "fatherId", "notes"];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  const animal = await prisma.animal.update({
    where: { animalId: id },
    data: update,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/animals');
  revalidatePath('/admin/animals/[id]', 'page');
  revalidatePath('/admin/grafieke');
  revalidatePath('/dashboard');
  return NextResponse.json(animal);
}
