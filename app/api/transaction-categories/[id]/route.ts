import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";

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

  const category = await prisma.transactionCategory.findUnique({
    where: { id },
  });

  if (!category) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (category.isDefault) {
    return NextResponse.json(
      { error: "Verstekategorieë kan nie geskrap word nie" },
      { status: 400 }
    );
  }

  await prisma.transactionCategory.delete({ where: { id } });
  revalidateTransactionWrite(db.slug);
  return NextResponse.json({ ok: true });
}
