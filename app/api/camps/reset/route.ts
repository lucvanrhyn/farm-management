import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateCampWrite } from "@/lib/server/revalidate";

export async function DELETE(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!await verifyFreshAdminRole(session.user.id, slug)) {
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

  revalidateCampWrite(slug);

  return NextResponse.json({ success: true });
}
