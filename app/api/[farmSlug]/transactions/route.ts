import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const _authGet = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _authGet) return NextResponse.json({ error: _authGet.error }, { status: _authGet.status });
  const prisma = _authGet.prisma;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = {};
  if (from || to) {
    const dateFilter: Record<string, string> = {};
    if (from) dateFilter.gte = `${from}-01`;
    if (to) dateFilter.lte = `${to}-31`;
    where.date = dateFilter;
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { date: "desc" },
  });

  // Compute summary
  let income = 0;
  let expenses = 0;
  for (const tx of transactions) {
    if (tx.type === "income") {
      income += tx.amount;
    } else {
      expenses += tx.amount;
    }
  }

  return NextResponse.json({
    transactions,
    summary: { income, expenses, net: income - expenses },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  if (_auth.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const prisma = _auth.prisma;

  const body = await req.json();
  const {
    type, category, amount, description, date, campId, animalId, reference,
    saleType, counterparty, quantity, avgMassKg, fees, transportCost, animalIds,
  } = body;

  if (!type || !category || amount == null || !date) {
    return NextResponse.json(
      { error: "type, category, amount, date required" },
      { status: 400 },
    );
  }

  if (saleType != null && saleType !== "auction" && saleType !== "private") {
    return NextResponse.json(
      { error: "saleType must be 'auction' or 'private'" },
      { status: 400 },
    );
  }

  const transaction = await prisma.transaction.create({
    data: {
      type,
      category,
      amount: parseFloat(amount),
      date,
      description: description ?? "",
      campId: campId ?? null,
      animalId: animalId ?? null,
      reference: reference ?? null,
      createdBy: session.user?.email ?? null,
      saleType: saleType ?? null,
      counterparty: counterparty ?? null,
      quantity: quantity != null ? parseInt(quantity, 10) : null,
      avgMassKg: avgMassKg != null ? parseFloat(avgMassKg) : null,
      fees: fees != null ? parseFloat(fees) : null,
      transportCost: transportCost != null ? parseFloat(transportCost) : null,
      animalIds: animalIds ?? null,
    },
  });

  revalidatePath(`/${farmSlug}/admin/finansies`);
  return NextResponse.json(transaction, { status: 201 });
}
