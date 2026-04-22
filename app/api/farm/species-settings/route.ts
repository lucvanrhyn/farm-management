import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getAllSpeciesConfigs } from "@/lib/species/registry";
import { getUserRoleForFarm } from "@/lib/auth";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";

function getFarmSlugFromRequest(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get("farmSlug");
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const farmSlug = getFarmSlugFromRequest(req);
  if (!farmSlug) {
    return NextResponse.json({ error: "farmSlug query param required" }, { status: 400 });
  }

  const userFarms = (session.user as { farms?: Array<{ slug: string }> }).farms ?? [];
  if (!userFarms.some((f) => f.slug === farmSlug)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }

  const rows = await prisma.farmSpeciesSettings.findMany();
  const rowBySpecies = Object.fromEntries(rows.map((r) => [r.species, r]));

  // Merge registry defaults with DB rows — any species with no row defaults to enabled=true
  const allConfigs = getAllSpeciesConfigs();
  const result = allConfigs.map((config) => ({
    species: config.id,
    enabled: rowBySpecies[config.id]?.enabled ?? true,
  }));

  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const farmSlug = getFarmSlugFromRequest(req);
  if (!farmSlug) {
    return NextResponse.json({ error: "farmSlug query param required" }, { status: 400 });
  }

  if (getUserRoleForFarm(session, farmSlug) !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.species !== "string" || !body.species.trim()) {
    return NextResponse.json({ error: "species must be a non-empty string" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const { species, enabled } = body as { species: string; enabled: boolean };

  const updated = await prisma.farmSpeciesSettings.upsert({
    where: { species },
    update: { enabled },
    create: { species, enabled },
  });

  revalidateSettingsWrite(farmSlug);
  return NextResponse.json({ species: updated.species, enabled: updated.enabled });
}
