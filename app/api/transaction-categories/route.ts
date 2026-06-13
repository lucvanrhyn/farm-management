import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { DEFAULT_CATEGORIES } from "@/lib/constants/default-categories";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";
import { routeError } from "@/lib/server/route";

export async function GET(request: NextRequest) {
  const ctx = await getFarmContext(request);
  if (!ctx) return routeError("AUTH_REQUIRED", "Unauthorized", 401);
  const { prisma } = ctx;

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
  const ctx = await getFarmContext(request);
  if (!ctx) return routeError("AUTH_REQUIRED", "Unauthorized", 401);
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return routeError("FORBIDDEN", "Forbidden");
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return routeError("FORBIDDEN", "Forbidden");
  }

  const { name, type } = await request.json();
  if (!name || !type || !["income", "expense"].includes(type)) {
    return routeError("VALIDATION_FAILED", "name and type required");
  }

  const category = await prisma.transactionCategory.create({
    data: { name: name.trim(), type, isDefault: false },
  });

  revalidateTransactionWrite(slug);
  return NextResponse.json(category, { status: 201 });
}
