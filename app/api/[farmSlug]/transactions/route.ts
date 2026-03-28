import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { SessionFarm } from "@/types/next-auth";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;

  const accessible = (session.user?.farms as SessionFarm[] | undefined)?.some(
    (f) => f.slug === farmSlug,
  );
  if (!accessible) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

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

  const accessible = (session.user?.farms as SessionFarm[] | undefined)?.some(
    (f) => f.slug === farmSlug,
  );
  if (!accessible) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  const body = await req.json();
  const { type, category, amount, description, date, campId, animalId, reference } = body;

  if (!type || !category || amount == null || !date) {
    return NextResponse.json(
      { error: "type, category, amount, date required" },
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
    },
  });

  revalidatePath(`/${farmSlug}/admin/finansies`);
  return NextResponse.json(transaction, { status: 201 });
}
