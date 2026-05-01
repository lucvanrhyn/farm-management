import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getFarmContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const {
    type, category, amount, date, description, animalId, campId, reference,
    saleType, counterparty, quantity, avgMassKg, fees, transportCost, animalIds,
    isForeign,
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
  if (isForeign !== undefined) data.isForeign = isForeign === true;

  const transaction = await prisma.transaction.update({
    where: { id },
    data,
  });

  revalidateTransactionWrite(slug);
  return NextResponse.json(transaction);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getFarmContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  await prisma.transaction.delete({ where: { id } });
  revalidateTransactionWrite(slug);
  return NextResponse.json({ ok: true });
}
