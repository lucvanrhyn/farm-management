/**
 * GET /api/[farmSlug]/nvd/[id] — return a single NVD's full snapshot data
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { SessionFarm } from "@/types/next-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug, id } = await params;

  const accessible = (session.user?.farms as SessionFarm[] | undefined)?.some(
    (f) => f.slug === farmSlug
  );
  if (!accessible) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  const record = await prisma.nvdRecord.findUnique({ where: { id } });
  if (!record) return NextResponse.json({ error: "NVD not found" }, { status: 404 });

  return NextResponse.json(record);
}
