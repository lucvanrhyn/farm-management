/**
 * POST /api/[farmSlug]/tax/it3/[id]/void — void an issued IT3 snapshot (ADMIN)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { voidIt3Snapshot } from "@/lib/server/sars-it3";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; id: string }> },
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

  const record = await prisma.it3Snapshot.findUnique({
    where: { id },
    select: { id: true, voidedAt: true },
  });
  if (!record) return NextResponse.json({ error: "IT3 snapshot not found" }, { status: 404 });
  if (record.voidedAt) {
    return NextResponse.json({ error: "Snapshot is already voided" }, { status: 409 });
  }

  // An empty body is legitimate (admin is voiding without a stated reason),
  // but malformed JSON is a client bug worth surfacing rather than silently
  // defaulting — this endpoint writes to the audit trail.
  let body: { reason?: string } = {};
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > 0) {
    try {
      body = (await req.json()) as { reason?: string };
    } catch (err) {
      console.error("[it3 void] malformed request body:", err);
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 },
      );
    }
  }

  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim()
    : "Voided by admin";

  await voidIt3Snapshot(prisma, id, reason);

  revalidateObservationWrite(farmSlug);
  return NextResponse.json({ ok: true });
}
