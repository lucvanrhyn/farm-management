/**
 * POST /api/[farmSlug]/nvd/validate — dry-run withdrawal check for a set of animals
 *
 * Wave G1 (#165) — migrated onto `tenantWriteSlug`. Returns
 * `{ ok: true }` or `{ ok: false, blockers: WithdrawalAnimal[] }`. No
 * side effects — safe to call on every animal-selection change from the
 * form. The handler still owns the body shape validation; an empty /
 * non-array `animalIds` payload returns `VALIDATION_FAILED`.
 */
import { NextResponse } from "next/server";

import { tenantWriteSlug } from "@/lib/server/route";
import { RouteValidationError } from "@/lib/server/route";
import { validateNvdAnimals } from "@/lib/domain/nvd";

export const dynamic = "force-dynamic";

interface ValidateBody {
  animalIds: string[];
}

const schema = {
  parse(input: unknown): ValidateBody {
    const obj = (input ?? {}) as { animalIds?: unknown };
    if (!Array.isArray(obj.animalIds)) {
      throw new RouteValidationError("animalIds must be an array", {
        field: "animalIds",
      });
    }
    return { animalIds: obj.animalIds as string[] };
  },
};

export const POST = tenantWriteSlug<ValidateBody, { farmSlug: string }>({
  schema,
  handle: async (ctx, body) => {
    const result = await validateNvdAnimals(ctx.prisma, body.animalIds);
    return NextResponse.json(result);
  },
});
