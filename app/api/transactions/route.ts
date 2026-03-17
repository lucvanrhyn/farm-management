import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const category = searchParams.get("category");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (category) where.category = category;
  if (from || to) {
    const dateFilter: Record<string, string> = {};
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;
    where.date = dateFilter;
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { date: "desc" },
  });

  return NextResponse.json(transactions);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { type, category, amount, date, description, animalId, campId, reference } = body;

  if (!type || !category || amount == null || !date) {
    return NextResponse.json(
      { error: "type, category, amount, date required" },
      { status: 400 }
    );
  }

  const transaction = await prisma.transaction.create({
    data: {
      type,
      category,
      amount: parseFloat(amount),
      date,
      description: description ?? "",
      animalId: animalId ?? null,
      campId: campId ?? null,
      reference: reference ?? null,
      createdBy: session.user?.email ?? null,
    },
  });

  revalidatePath('/admin');
  revalidatePath('/admin/finansies');
  return NextResponse.json(transaction, { status: 201 });
}
