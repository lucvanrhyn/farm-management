/**
 * POST /api/[farmSlug]/nvd/validate — dry-run withdrawal check for a set of animals
 * Returns { ok: true } or { ok: false, blockers: WithdrawalAnimal[] }
 * No side effects — safe to call on every animal-selection change from the form.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { SessionFarm } from "@/types/next-auth";
import { validateNvdAnimals } from "@/lib/server/nvd";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;

  const accessible = (session.user?.farms as SessionFarm[] | undefined)?.some(
    (f) => f.slug === farmSlug
  );
  if (!accessible) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  let body: { animalIds?: unknown };
  try {
    body = (await req.json()) as { animalIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.animalIds)) {
    return NextResponse.json({ error: "animalIds must be an array" }, { status: 400 });
  }

  const result = await validateNvdAnimals(prisma, body.animalIds as string[]);
  return NextResponse.json(result);
}
