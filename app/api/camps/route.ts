import { NextResponse } from "next/server";
import { tenantRead, adminWrite, RouteValidationError } from "@/lib/server/route";
import { revalidateCampWrite } from "@/lib/server/revalidate";
import { getCachedCampList } from "@/lib/server/cached";
import { CAMP_COLOR_PALETTE } from "@/lib/camp-colors";
import { timeAsync } from "@/lib/server/server-timing";
import { isValidSpecies } from "@/lib/species/registry";
import type { SpeciesId } from "@/lib/species/types";

interface CreateCampBody {
  campId: string;
  campName: string;
  species: SpeciesId;
  sizeHectares?: number | string | null;
  waterSource?: string | null;
  geojson?: string | null;
  color?: string | null;
}

/**
 * Sentinel used by the schema to mark "species was omitted entirely" — the
 * route handler converts this into the typed 422 MISSING_SPECIES response
 * required by issue #232 (no silent inherit from the Prisma column default).
 * Schema-level VALIDATION_FAILED would 400 with `details.fieldErrors.species`
 * — distinct from this 422, which signals the user simply forgot to choose.
 */
const SPECIES_OMITTED = "__species_omitted__" as const;

const createCampSchema = {
  parse(input: unknown): CreateCampBody {
    const body = (input ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    if (typeof body.campId !== "string" || !body.campId) {
      errors.campId = "campId is required";
    }
    if (typeof body.campName !== "string" || !body.campName) {
      errors.campName = "campName is required";
    }
    // species: omitted → sentinel (handler maps to 422 MISSING_SPECIES);
    // present-but-invalid → schema 400 VALIDATION_FAILED.
    let species: string;
    if (body.species === undefined || body.species === null || body.species === "") {
      species = SPECIES_OMITTED;
    } else if (typeof body.species !== "string" || !isValidSpecies(body.species)) {
      errors.species = "species must be one of cattle | sheep | game";
      species = SPECIES_OMITTED;
    } else {
      species = body.species;
    }
    if (
      body.color !== undefined &&
      body.color !== null &&
      (typeof body.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(body.color))
    ) {
      errors.color = "color must be a valid hex color (e.g. #2563EB)";
    }
    if (Object.keys(errors).length > 0) {
      throw new RouteValidationError(
        Object.values(errors)[0] ?? "Invalid body",
        { fieldErrors: errors },
      );
    }
    return { ...(body as Record<string, unknown>), species } as unknown as CreateCampBody;
  },
};

export const GET = tenantRead({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const species = searchParams.get("species") ?? undefined;
    const result = await timeAsync("query", () =>
      getCachedCampList(ctx.slug, species),
    );
    return NextResponse.json(result);
  },
});

export const POST = adminWrite<CreateCampBody>({
  schema: createCampSchema,
  revalidate: revalidateCampWrite,
  handle: async (ctx, body) => {
    const { prisma } = ctx;
    const { campId, campName, species, sizeHectares, waterSource, geojson, color } = body;

    // Issue #232 — typed 422 when species was omitted. Distinct from schema
    // VALIDATION_FAILED (400) so clients can render "please pick a species"
    // UX without parsing the field-errors bag.
    if ((species as string) === SPECIES_OMITTED) {
      return NextResponse.json(
        { error: "MISSING_SPECIES" },
        { status: 422 },
      );
    }

    // Phase A of #28: campId is no longer globally unique (composite UNIQUE on
    // species+campId). The duplicate check MUST be species-scoped so the same
    // campId can exist across species (cattle's NORTH-01 vs sheep's NORTH-01
    // are distinct rows).
    const existing = await prisma.camp.findFirst({ where: { campId, species } });
    if (existing) {
      return NextResponse.json(
        { error: "A camp with this ID already exists" },
        { status: 409 },
      );
    }

    // Auto-assign a color from the palette if not provided.
    let assignedColor = color as string | undefined | null;
    if (!assignedColor) {
      const campCount = await prisma.camp.count();
      assignedColor = CAMP_COLOR_PALETTE[campCount % CAMP_COLOR_PALETTE.length];
    }

    const camp = await prisma.camp.create({
      data: {
        campId,
        campName,
        species,
        sizeHectares: sizeHectares ? Number(sizeHectares) : null,
        waterSource: waterSource || null,
        geojson: geojson || null,
        color: assignedColor ?? null,
      },
    });

    // Return snake_case to match the GET /api/camps response shape.
    return NextResponse.json(
      {
        camp_id: camp.campId,
        camp_name: camp.campName,
        size_hectares: camp.sizeHectares,
        water_source: camp.waterSource,
        geojson: camp.geojson,
        color: camp.color,
        animal_count: 0,
      },
      { status: 201 },
    );
  },
});
