/**
 * POST /api/[farmSlug]/tax/it3/[id]/void — void an issued IT3 snapshot (ADMIN)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { voidIt3Snapshot } from "@/lib/server/sars-it3";

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
  const prisma = _auth.prisma;

  const record = await prisma.it3Snapshot.findUnique({
    where: { id },
    select: { id: true, voidedAt: true },
  });
  if (!record) return NextResponse.json({ error: "IT3 snapshot not found" }, { status: 404 });
  if (record.voidedAt) {
    return NextResponse.json({ error: "Snapshot is already voided" }, { status: 409 });
  }

  let body: { reason?: string };
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    body = {};
  }

  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim()
    : "Voided by admin";

  await voidIt3Snapshot(prisma, id, reason);

  return NextResponse.json({ ok: true });
}
