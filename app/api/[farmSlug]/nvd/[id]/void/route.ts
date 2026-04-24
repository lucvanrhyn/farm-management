/**
 * POST /api/[farmSlug]/nvd/[id]/void — void an issued NVD (ADMIN only)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { voidNvd } from "@/lib/server/nvd";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug, id } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  if (_auth.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, _auth.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const prisma = _auth.prisma;

  // Check the NVD exists and is not already voided
  const record = await prisma.nvdRecord.findUnique({
    where: { id },
    select: { id: true, voidedAt: true },
  });
  if (!record) return NextResponse.json({ error: "NVD not found" }, { status: 404 });
  if (record.voidedAt) return NextResponse.json({ error: "NVD is already voided" }, { status: 409 });

  let body: { reason?: string };
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    body = {};
  }

  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim()
    : "Voided by admin";

  await voidNvd(prisma, id, reason);

  revalidateObservationWrite(farmSlug);
  return NextResponse.json({ ok: true });
}
