import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!await verifyFreshAdminRole(session.user.id, db.slug)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.transaction.deleteMany({});
  await prisma.transactionCategory.deleteMany({});

  revalidatePath("/admin");
  revalidatePath("/admin/finansies");
  revalidatePath("/admin/grafieke");

  return NextResponse.json({ success: true });
}
