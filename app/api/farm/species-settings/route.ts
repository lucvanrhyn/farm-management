import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { getAllSpeciesConfigs } from "@/lib/species/registry";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";

function getFarmSlugFromRequest(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get("farmSlug");
}

export async function GET(req: NextRequest) {
  const farmSlug = getFarmSlugFromRequest(req);
  if (!farmSlug) {
    return NextResponse.json({ error: "farmSlug query param required" }, { status: 400 });
  }

  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await ctx.prisma.farmSpeciesSettings.findMany();
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
  const farmSlug = getFarmSlugFromRequest(req);
  if (!farmSlug) {
    return NextResponse.json({ error: "farmSlug query param required" }, { status: 400 });
  }

  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, session } = ctx;

  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, farmSlug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
