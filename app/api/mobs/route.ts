/**
 * GET  /api/mobs — list mobs with derived animal counts.
 * POST /api/mobs — create a mob (ADMIN-only) with species-scoped camp guard.
 *
 * Wave B (#151) — adapter-only wiring. The hand-rolled handler shape is
 * gone; auth, role gates, body parse, typed-error envelope, and revalidate
 * are owned by the `tenantRead` / `adminWrite` adapters from
 * `lib/server/route/`. The business logic lives in `lib/domain/mobs/*`.
 *
 * Wire shapes:
 *   - GET 200  → `[{ id, name, current_camp, animal_count }]`
 *   - POST 201 → `{ id, name, current_camp, animal_count }`
 *   - POST 422 → `{ error: "WRONG_SPECIES" | "NOT_FOUND" }` (typed-error path)
 *   - POST 400 → `{ error: "VALIDATION_FAILED", message, details }` (validation)
 */
import { NextResponse } from "next/server";

import { tenantRead, adminWrite, RouteValidationError } from "@/lib/server/route";
import { revalidateMobWrite } from "@/lib/server/revalidate";
import { isValidSpecies } from "@/lib/species/registry";
import type { SpeciesId } from "@/lib/species/types";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import {
  listMobs,
  createMob,
  type CreateMobInput,
} from "@/lib/domain/mobs";

interface CreateMobBody {
  name: string;
  currentCamp: string;
  species: SpeciesId;
}

const createMobSchema = {
  parse(input: unknown): CreateMobBody {
    const body = (input ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    if (typeof body.name !== "string" || !body.name) {
      errors.name = "name is required";
    }
    if (typeof body.currentCamp !== "string" || !body.currentCamp) {
      errors.currentCamp = "currentCamp is required";
    }
    if (
      typeof body.species !== "string" ||
      !isValidSpecies(body.species as string)
    ) {
      errors.species = "species is required (cattle | sheep | game)";
    }
    if (Object.keys(errors).length > 0) {
      throw new RouteValidationError(
        Object.values(errors)[0] ?? "Invalid body",
        { fieldErrors: errors },
      );
    }
    return body as unknown as CreateMobBody;
  },
};

export const GET = tenantRead({
  handle: async (ctx) => {
    // Wave 226 (#226): scope the list to the active FarmMode so a
    // multi-species tenant doesn't see the other species' mobs bleed onto
    // the cattle dashboard. Cookie is read per-request via getFarmMode.
    const mode = await getFarmMode(ctx.slug);
    const result = await listMobs(ctx.prisma, mode);
    return NextResponse.json(result);
  },
});

export const POST = adminWrite<CreateMobBody>({
  schema: createMobSchema,
  revalidate: revalidateMobWrite,
  handle: async (ctx, body) => {
    const input: CreateMobInput = {
      name: body.name,
      currentCamp: body.currentCamp,
      species: body.species,
      farmSlug: ctx.slug,
    };
    const result = await createMob(ctx.prisma, input);
    return NextResponse.json(result, { status: 201 });
  },
});
