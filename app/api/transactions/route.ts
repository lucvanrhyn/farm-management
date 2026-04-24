import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const category = searchParams.get("category");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !DATE_RE.test(from)) {
    return NextResponse.json({ error: "from must be YYYY-MM-DD" }, { status: 400 });
  }
  if (to && !DATE_RE.test(to)) {
    return NextResponse.json({ error: "to must be YYYY-MM-DD" }, { status: 400 });
  }

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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, db.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const {
    type, category, amount, date, description, animalId, campId, reference,
    saleType, counterparty, quantity, avgMassKg, fees, transportCost, animalIds,
  } = body;

  if (!type || !category || amount == null || !date) {
    return NextResponse.json(
      { error: "type, category, amount, date required" },
      { status: 400 }
    );
  }

  if (saleType != null && saleType !== "auction" && saleType !== "private") {
    return NextResponse.json(
      { error: "saleType must be 'auction' or 'private'" },
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
      saleType: saleType ?? null,
      counterparty: counterparty ?? null,
      quantity: quantity != null ? parseInt(quantity, 10) : null,
      avgMassKg: avgMassKg != null ? parseFloat(avgMassKg) : null,
      fees: fees != null ? parseFloat(fees) : null,
      transportCost: transportCost != null ? parseFloat(transportCost) : null,
      animalIds: animalIds ?? null,
    },
  });

  revalidateTransactionWrite(db.slug);
  return NextResponse.json(transaction, { status: 201 });
}
