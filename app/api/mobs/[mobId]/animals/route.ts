/**
 * POST   /api/mobs/[mobId]/animals — attach animals to a mob.
 * DELETE /api/mobs/[mobId]/animals — detach animals from a mob.
 *
 * Wave B (#151) — adapter-only wiring. Business logic lives in
 * `lib/domain/mobs/{attach-animals,detach-animals}.ts`. Cross-species
 * hard-block (Wave 4 A3 / Codex 2026-05-02 HIGH) and the
 * requested-vs-actual response shape are owned by the domain ops.
 *
 * Wire shapes:
 *   - POST/DELETE 200 → `{ success: true, count }`
 *                     OR `{ success: true, count, requested, mismatched }`
 *                       when the attach/detach updateMany rejected some animals.
 *   - 404            → `{ error: "Mob not found" }`     (MobNotFoundError)
 *   - 400            → `{ error: "VALIDATION_FAILED", message, details }`
 */
import { NextResponse } from "next/server";

import { adminWrite, RouteValidationError } from "@/lib/server/route";
import { revalidateMobWrite } from "@/lib/server/revalidate";
import {
  attachAnimalsToMob,
  detachAnimalsFromMob,
} from "@/lib/domain/mobs";

interface AnimalsBody {
  animalIds: string[];
}

const animalsBodySchema = {
  parse(input: unknown): AnimalsBody {
    const body = (input ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.animalIds) || body.animalIds.length === 0) {
      throw new RouteValidationError("animalIds array is required", {
        fieldErrors: { animalIds: "animalIds array is required" },
      });
    }
    return { animalIds: body.animalIds as string[] };
  },
};

export const POST = adminWrite<AnimalsBody, { mobId: string }>({
  schema: animalsBodySchema,
  revalidate: revalidateMobWrite,
  handle: async (ctx, body, _req, params) => {
    const { mobId } = params;
    const result = await attachAnimalsToMob(ctx.prisma, {
      mobId,
      animalIds: body.animalIds,
    });
    return NextResponse.json(result);
  },
});

export const DELETE = adminWrite<AnimalsBody, { mobId: string }>({
  schema: animalsBodySchema,
  revalidate: revalidateMobWrite,
  handle: async (ctx, body, _req, params) => {
    const { mobId } = params;
    const result = await detachAnimalsFromMob(ctx.prisma, {
      mobId,
      animalIds: body.animalIds,
    });
    return NextResponse.json(result);
  },
});
