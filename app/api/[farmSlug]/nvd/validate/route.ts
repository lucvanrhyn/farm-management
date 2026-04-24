/**
 * POST /api/[farmSlug]/nvd/validate — dry-run withdrawal check for a set of animals
 * Returns { ok: true } or { ok: false, blockers: WithdrawalAnimal[] }
 * No side effects — safe to call on every animal-selection change from the form.
 */
import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { validateNvdAnimals } from "@/lib/server/nvd";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { animalIds?: unknown };
  try {
    body = (await req.json()) as { animalIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.animalIds)) {
    return NextResponse.json({ error: "animalIds must be an array" }, { status: 400 });
  }

  const result = await validateNvdAnimals(ctx.prisma, body.animalIds as string[]);
  return NextResponse.json(result);
}
