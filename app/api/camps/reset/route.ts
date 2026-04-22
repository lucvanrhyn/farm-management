import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateCampWrite } from "@/lib/server/revalidate";

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

  const activeAnimals = await prisma.animal.count({ where: { status: "Active" } });
  if (activeAnimals > 0) {
    return NextResponse.json(
      { error: `Cannot remove all camps while ${activeAnimals} active animal(s) exist. Clear animals first.` },
      { status: 409 }
    );
  }

  await prisma.camp.deleteMany({});

  revalidateCampWrite(db.slug);

  return NextResponse.json({ success: true });
}
