import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForRequest } from "@/lib/farm-prisma";
import { revalidatePath } from "next/cache";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role?.toUpperCase() !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaForRequest();
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { id } = await params;
  const body = await request.json();
  const { type, category, amount, date, description, animalId, campId, reference } = body;

  const data: Record<string, unknown> = {};
  if (type !== undefined) data.type = type;
  if (category !== undefined) data.category = category;
  if (amount !== undefined) data.amount = parseFloat(amount);
  if (date !== undefined) data.date = date;
  if (description !== undefined) data.description = description;
  if (animalId !== undefined) data.animalId = animalId;
  if (campId !== undefined) data.campId = campId;
  if (reference !== undefined) data.reference = reference;

  const transaction = await prisma.transaction.update({
    where: { id },
    data,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/finansies');
  return NextResponse.json(transaction);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role?.toUpperCase() !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaForRequest();
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { id } = await params;
  await prisma.transaction.delete({ where: { id } });
  revalidatePath('/admin');
  revalidatePath('/admin/finansies');
  return NextResponse.json({ ok: true });
}
