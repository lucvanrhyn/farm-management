/**
 * GET /api/[farmSlug]/nvd/[id] — return a single NVD's full snapshot data
 */
import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; id: string }> }
) {
  const { farmSlug, id } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const record = await ctx.prisma.nvdRecord.findUnique({ where: { id } });
  if (!record) return NextResponse.json({ error: "NVD not found" }, { status: 404 });

  return NextResponse.json(record);
}
