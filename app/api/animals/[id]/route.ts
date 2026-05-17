/**
 * GET   /api/animals/[id] — fetch a single animal by its unique animalId.
 * PATCH /api/animals/[id] — update an animal (role-gated field allowlist,
 *                           #28 cross-species parent guard, #98
 *                           cross-species camp guard).
 *
 * Wave 309b (ADR-0001 Wave B, #309) — adapter-only wiring. The business
 * logic (authorization matrix, enum validation, field allowlist, the
 * hoisted single child-species read shared by both guards) lives in
 * `lib/domain/animals/{get-animal,update-animal}.ts`. The route keeps
 * only its transport envelopes: `tenantRead` (GET), `tenantWrite` +
 * `revalidateAnimalWrite` (PATCH).
 *
 * Wire shapes — BYTE-IDENTICAL to the pre-extraction handler (this route
 * carries authorization; the wave is strictly behaviour-preserving):
 *   - GET 200            → the animal row
 *   - GET 404            → `{ error: "Not found" }`         (AnimalNotFoundError)
 *   - PATCH 200          → the updated animal row
 *   - PATCH 403          → `{ error: "FORBIDDEN", message: "Forbidden" }`
 *                          (AnimalFieldForbiddenError — the exact
 *                           `routeError("FORBIDDEN","Forbidden",403)`
 *                           envelope, reproduced via the same minter)
 *   - PATCH 400          → `{ error: "status must be one of: ..." }` /
 *                          `{ error: "sex must be one of: ..." }`
 *                          (InvalidAnimalFieldError — legacy free text)
 *   - PATCH 422          → `{ error: "PARENT_NOT_FOUND" }`  (ParentNotFoundError)
 *   - PATCH 422          → `{ error: "CROSS_SPECIES_BLOCKED" }`
 *                          (CrossSpeciesBlockedError — reused from
 *                           `@/lib/domain/mobs/move-mob`, already mapped)
 *   - PATCH 422          → `{ error: "NOT_FOUND" | "WRONG_SPECIES" }`
 *                          (SpeciesScopedCampError — the #98 camp guard)
 *
 * All non-2xx bodies are minted by `mapApiDomainError` (owned by the
 * `tenantRead` / `tenantWrite` adapter try/catch); the route never calls
 * `NextResponse.json({ error: ... })` for an error path itself.
 */
import { NextResponse } from "next/server";
import { tenantRead, tenantWrite } from "@/lib/server/route";
import { revalidateAnimalWrite } from "@/lib/server/revalidate";
import { getAnimal, updateAnimal } from "@/lib/domain/animals";

export const GET = tenantRead<{ id: string }>({
  handle: async (ctx, _req, params) => {
    const animal = await getAnimal(ctx.prisma, params.id);
    return NextResponse.json(animal);
  },
});

export const PATCH = tenantWrite<Record<string, unknown>, { id: string }>({
  revalidate: revalidateAnimalWrite,
  handle: async (ctx, body, _req, params) => {
    const animal = await updateAnimal(ctx.prisma, {
      animalId: params.id,
      role: ctx.role,
      slug: ctx.slug,
      body,
    });
    return NextResponse.json(animal);
  },
});
