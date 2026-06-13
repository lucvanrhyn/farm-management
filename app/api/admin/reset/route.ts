import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { routeError } from "@/lib/server/route";

export async function DELETE(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return routeError("AUTH_REQUIRED", "Unauthorized", 401);
  const { prisma, role, slug, session } = ctx;
  // audit-allow-error-envelope: admin-reset (destructive) non-admin 403 left bare pending admin-surface envelope migration sign-off (file already routeErrors the 401); convert under Wave F/G.
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    // audit-allow-error-envelope: admin-reset (destructive) stale-admin 403 left bare pending admin-surface envelope migration sign-off (file already routeErrors the 401); convert under Wave F/G.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Require explicit confirmation body to prevent accidental or CSRF-driven wipes
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  if ((body as Record<string, unknown> | null)?.confirm !== "DELETE ALL") {
    return NextResponse.json(
      // audit-allow-error-envelope: admin-reset confirmation-required 400 — the literal text IS the operator contract (instructs the required {confirm:'DELETE ALL'} body); must stay bare.
      { error: 'Send { "confirm": "DELETE ALL" } to confirm this destructive action' },
      { status: 400 },
    );
  }

  await prisma.transaction.deleteMany({});
  await prisma.transactionCategory.deleteMany({});
  await crossSpecies(prisma, "farm-wide-audit").observation.deleteMany({});
  await crossSpecies(prisma, "farm-wide-audit").animal.deleteMany({});

  revalidatePath("/admin");
  revalidatePath("/admin/animals");
  revalidatePath("/admin/observations");
  revalidatePath("/admin/finansies");
  revalidatePath("/admin/grafieke");
  revalidatePath("/dashboard");

  return NextResponse.json({ success: true });
}
