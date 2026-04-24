import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";

export async function DELETE(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Require explicit confirmation body to prevent accidental or CSRF-driven wipes
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  if ((body as Record<string, unknown> | null)?.confirm !== "DELETE ALL") {
    return NextResponse.json(
      { error: 'Send { "confirm": "DELETE ALL" } to confirm this destructive action' },
      { status: 400 },
    );
  }

  await prisma.transaction.deleteMany({});
  await prisma.transactionCategory.deleteMany({});
  await prisma.observation.deleteMany({});
  await prisma.animal.deleteMany({});

  revalidatePath("/admin");
  revalidatePath("/admin/animals");
  revalidatePath("/admin/observations");
  revalidatePath("/admin/finansies");
  revalidatePath("/admin/grafieke");
  revalidatePath("/dashboard");

  return NextResponse.json({ success: true });
}
