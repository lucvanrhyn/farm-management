import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const {
    type, category, amount, date, description, animalId, campId, reference,
    saleType, counterparty, quantity, avgMassKg, fees, transportCost, animalIds,
  } = body;

  if (saleType != null && saleType !== "auction" && saleType !== "private") {
    return NextResponse.json(
      { error: "saleType must be 'auction' or 'private'" },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (type !== undefined) data.type = type;
  if (category !== undefined) data.category = category;
  if (amount !== undefined) data.amount = parseFloat(amount);
  if (date !== undefined) data.date = date;
  if (description !== undefined) data.description = description;
  if (animalId !== undefined) data.animalId = animalId;
  if (campId !== undefined) data.campId = campId;
  if (reference !== undefined) data.reference = reference;
  if (saleType !== undefined) data.saleType = saleType ?? null;
  if (counterparty !== undefined) data.counterparty = counterparty ?? null;
  if (quantity !== undefined) data.quantity = quantity != null ? parseInt(quantity, 10) : null;
  if (avgMassKg !== undefined) data.avgMassKg = avgMassKg != null ? parseFloat(avgMassKg) : null;
  if (fees !== undefined) data.fees = fees != null ? parseFloat(fees) : null;
  if (transportCost !== undefined) data.transportCost = transportCost != null ? parseFloat(transportCost) : null;
  if (animalIds !== undefined) data.animalIds = animalIds ?? null;

  const transaction = await prisma.transaction.update({
    where: { id },
    data,
  });

  revalidateTransactionWrite(db.slug);
  return NextResponse.json(transaction);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  await prisma.transaction.delete({ where: { id } });
  revalidateTransactionWrite(db.slug);
  return NextResponse.json({ ok: true });
}
