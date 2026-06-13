import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";
import { routeError } from "@/lib/server/route";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getFarmContext(request);
  if (!ctx) return routeError("AUTH_REQUIRED", "Unauthorized", 401);
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return routeError("FORBIDDEN", "Forbidden");
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return routeError("FORBIDDEN", "Forbidden");
  }

  const { id } = await params;

  const category = await prisma.transactionCategory.findUnique({
    where: { id },
  });

  if (!category) {
    return routeError("NOT_FOUND", "Not found", 404);
  }

  if (category.isDefault) {
    return routeError(
      "VALIDATION_FAILED",
      "Verstekategorieë kan nie geskrap word nie",
    );
  }

  await prisma.transactionCategory.delete({ where: { id } });
  revalidateTransactionWrite(slug);
  return NextResponse.json({ ok: true });
}
