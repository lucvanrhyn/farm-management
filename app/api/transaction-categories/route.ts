import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { DEFAULT_CATEGORIES } from "@/lib/constants/default-categories";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const count = await prisma.transactionCategory.count();
  if (count === 0) {
    await prisma.transactionCategory.createMany({ data: DEFAULT_CATEGORIES });
  }

  const categories = await prisma.transactionCategory.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    income: categories.filter((c) => c.type === "income"),
    expense: categories.filter((c) => c.type === "expense"),
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, type } = await request.json();
  if (!name || !type || !["income", "expense"].includes(type)) {
    return NextResponse.json({ error: "name and type required" }, { status: 400 });
  }

  const category = await prisma.transactionCategory.create({
    data: { name: name.trim(), type, isDefault: false },
  });

  revalidateTransactionWrite(db.slug);
  return NextResponse.json(category, { status: 201 });
}
