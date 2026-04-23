import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

async function authorize(params: Promise<{ farmSlug: string }>, requireAdmin = false) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: "Unauthorized", status: 401 } as const;

  const { farmSlug } = await params;
  const db = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in db) return db;

  if (requireAdmin && db.role !== "ADMIN") {
    return { error: "Forbidden", status: 403 } as const;
  }

  return { prisma: db.prisma, farmSlug: db.slug } as const;
}

function parseIntOrNull(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const auth = await authorize(params);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { prisma } = auth;

  const { searchParams } = new URL(req.url);
  const year = parseIntOrNull(searchParams.get("year"));
  const month = parseIntOrNull(searchParams.get("month"));
  const fromYear = parseIntOrNull(searchParams.get("fromYear"));
  const fromMonth = parseIntOrNull(searchParams.get("fromMonth"));
  const toYear = parseIntOrNull(searchParams.get("toYear"));
  const toMonth = parseIntOrNull(searchParams.get("toMonth"));

  const where: Record<string, unknown> = {};
  if (year !== null) where.year = year;
  if (month !== null) where.month = month;

  let records = await prisma.budget.findMany({
    where,
    orderBy: [{ year: "asc" }, { month: "asc" }, { categoryName: "asc" }],
  });

  if (fromYear !== null && fromMonth !== null && toYear !== null && toMonth !== null) {
    const fromKey = fromYear * 12 + (fromMonth - 1);
    const toKey = toYear * 12 + (toMonth - 1);
    records = records.filter((r) => {
      const key = r.year * 12 + (r.month - 1);
      return key >= fromKey && key <= toKey;
    });
  }

  return NextResponse.json({ records });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const auth = await authorize(params, true);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { prisma, farmSlug } = auth;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { year, month, categoryName, type, amount, notes } = body as {
    year?: unknown;
    month?: unknown;
    categoryName?: unknown;
    type?: unknown;
    amount?: unknown;
    notes?: unknown;
  };

  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year must be an integer 2000-2100" }, { status: 400 });
  }
  if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "month must be an integer 1-12" }, { status: 400 });
  }
  if (typeof categoryName !== "string" || categoryName.trim() === "") {
    return NextResponse.json({ error: "categoryName required" }, { status: 400 });
  }
  if (type !== "income" && type !== "expense") {
    return NextResponse.json({ error: "type must be 'income' or 'expense'" }, { status: 400 });
  }
  const amt = typeof amount === "number" ? amount : Number.parseFloat(String(amount));
  if (!Number.isFinite(amt) || amt < 0) {
    return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 });
  }
  const notesStr = typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null;

  const record = await prisma.budget.upsert({
    where: {
      budget_year_month_category: {
        year,
        month,
        categoryName: categoryName.trim(),
      },
    },
    create: {
      year,
      month,
      categoryName: categoryName.trim(),
      type,
      amount: amt,
      notes: notesStr,
    },
    update: {
      type,
      amount: amt,
      notes: notesStr,
    },
  });

  revalidateTransactionWrite(farmSlug);
  return NextResponse.json(record, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const auth = await authorize(params, true);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { prisma, farmSlug } = auth;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { amount, notes } = body as { amount?: unknown; notes?: unknown };
  const data: { amount?: number; notes?: string | null } = {};

  if (amount !== undefined) {
    const amt = typeof amount === "number" ? amount : Number.parseFloat(String(amount));
    if (!Number.isFinite(amt) || amt < 0) {
      return NextResponse.json({ error: "amount must be non-negative" }, { status: 400 });
    }
    data.amount = amt;
  }
  if (notes !== undefined) {
    data.notes = typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  try {
    const record = await prisma.budget.update({ where: { id }, data });
    revalidateTransactionWrite(farmSlug);
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const auth = await authorize(params, true);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { prisma, farmSlug } = auth;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.budget.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  try {
    await prisma.budget.delete({ where: { id } });
  } catch (err) {
    console.error("[budgets DELETE] DB error:", err);
    return NextResponse.json({ error: "Failed to delete budget record" }, { status: 500 });
  }

  revalidateTransactionWrite(farmSlug);
  return NextResponse.json({ ok: true });
}
