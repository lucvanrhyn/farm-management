/**
 * GET  /api/camps — list camps + animal counts (snake_case).
 * POST /api/camps — create a camp (species-scoped duplicate guard).
 *
 * Wave 316a (ADR-0001 Wave B, #309) — adapter-only wiring for POST.
 * Business logic lives in `lib/domain/camps/create-camp.ts`. Validation
 * stays in this route's `createCampSchema` adapter parse; the typed-error
 * envelope maps domain throws onto the existing wire shape via
 * `mapApiDomainError` (owned by the `adminWrite` adapter).
 *
 * GET stays a thin `tenantRead` cached delegate by design — extracting a
 * 3-line `getCachedCampList` wrapper would be a shallow pass-through
 * (deletion test: extracting it concentrates no complexity).
 *
 * Wire shapes (unchanged):
 *   - POST 201 → snake_case `{ camp_id, camp_name, size_hectares,
 *                water_source, geojson, color, animal_count: 0 }`
 *   - POST 422 → `{ error: "MISSING_SPECIES" }`   (MissingSpeciesError, #232)
 *   - POST 409 → `{ error: "A camp with this ID already exists" }`
 *                (DuplicateCampError — message preserved on wire)
 */
import { NextResponse } from "next/server";
import { tenantRead, adminWrite, RouteValidationError } from "@/lib/server/route";
import { revalidateCampWrite } from "@/lib/server/revalidate";
import { getCachedCampList } from "@/lib/server/cached";
import { timeAsync } from "@/lib/server/server-timing";
import { isValidSpecies } from "@/lib/species/registry";
import { createCamp, SPECIES_OMITTED, type CreateCampInput } from "@/lib/domain/camps";

const createCampSchema = {
  parse(input: unknown): CreateCampInput {
    const body = (input ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    if (typeof body.campId !== "string" || !body.campId) {
      errors.campId = "campId is required";
    }
    if (typeof body.campName !== "string" || !body.campName) {
      errors.campName = "campName is required";
    }
    // species: omitted → sentinel (createCamp maps to 422 MISSING_SPECIES);
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
    return { ...(body as Record<string, unknown>), species } as unknown as CreateCampInput;
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

export const POST = adminWrite<CreateCampInput>({
  schema: createCampSchema,
  revalidate: revalidateCampWrite,
  handle: async (ctx, body) => {
    const result = await createCamp(ctx.prisma, body);
    return NextResponse.json(result, { status: 201 });
  },
});
