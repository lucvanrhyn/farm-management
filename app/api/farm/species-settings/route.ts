import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { getAllSpeciesConfigs } from "@/lib/species/registry";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";
import { routeError } from "@/lib/server/route";

function getFarmSlugFromRequest(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get("farmSlug");
}

export async function GET(req: NextRequest) {
  const farmSlug = getFarmSlugFromRequest(req);
  if (!farmSlug) {
    return routeError("INVALID_BODY", "farmSlug query param required");
  }

  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return routeError("AUTH_REQUIRED", "Unauthorized", 401);

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
    return routeError("INVALID_BODY", "farmSlug query param required");
  }

  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return routeError("AUTH_REQUIRED", "Unauthorized", 401);
  const { prisma, role, session } = ctx;

  if (role !== "ADMIN") {
    return routeError("FORBIDDEN", "Forbidden");
  }
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, farmSlug))) {
    return routeError("FORBIDDEN", "Forbidden");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return routeError("INVALID_BODY", "Invalid JSON body");
  }

  if (typeof body.species !== "string" || !body.species.trim()) {
    return routeError("VALIDATION_FAILED", "species must be a non-empty string");
  }
  if (typeof body.enabled !== "boolean") {
    return routeError("VALIDATION_FAILED", "enabled must be a boolean");
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
