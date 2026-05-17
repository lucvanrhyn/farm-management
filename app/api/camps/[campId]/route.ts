/**
 * PATCH  /api/camps/[campId] — update a camp (optional-field patch).
 * DELETE /api/camps/[campId] — delete a camp (blocked when active animals
 *                              still reference it).
 *
 * Wave 309a (ADR-0001 Wave B, #309) — adapter-only wiring. Business logic
 * lives in `lib/domain/camps/{update-camp,delete-camp}.ts`. Validation
 * stays in this route's `patchCampSchema` adapter parse; the typed-error
 * envelope maps domain throws onto the existing wire shape via
 * `mapApiDomainError` (owned by the `adminWrite` adapter).
 *
 * Wire shapes (unchanged except not-found, see note):
 *   - PATCH 200  → `{ success: true }`
 *   - PATCH 404  → `{ error: "CAMP_NOT_FOUND" }`   (CampNotFoundError)
 *   - DELETE 200 → `{ success: true }`
 *   - DELETE 404 → `{ error: "CAMP_NOT_FOUND" }`   (CampNotFoundError)
 *   - DELETE 409 → `{ error: "Cannot delete camp with N active animal(s)..." }`
 *                  (CampHasActiveAnimalsError — message preserved on wire)
 *
 * Not-found note: the pre-extraction free-text body was
 * `{ error: "Camp not found" }` (404). Nothing depended on the literal
 * (the client renders `error` as an opaque alert string; no test
 * asserts it for this route), so this wave adopts the canonical
 * `CAMP_NOT_FOUND` code per ADR-0001 / Wave C direction. Status (404) is
 * unchanged; only the body string changes.
 */
import { NextResponse } from "next/server";
import { adminWrite, RouteValidationError } from "@/lib/server/route";
import { revalidateCampWrite } from "@/lib/server/revalidate";
import { updateCamp, deleteCamp, type PatchCampBody } from "@/lib/domain/camps";

const VELD_TYPES = new Set(["sweetveld", "sourveld", "mixedveld", "cultivated"]);

const patchCampSchema = {
  parse(input: unknown): PatchCampBody {
    const body = (input ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};

    if (
      body.color !== undefined &&
      body.color !== null &&
      (typeof body.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(body.color))
    ) {
      errors.color = "color must be a valid hex color (e.g. #2563EB)";
    }

    if (
      body.veldType !== undefined &&
      body.veldType !== null &&
      (typeof body.veldType !== "string" || !VELD_TYPES.has(body.veldType))
    ) {
      errors.veldType =
        "veldType must be one of: sweetveld, sourveld, mixedveld, cultivated";
    }

    for (const field of ["restDaysOverride", "maxGrazingDaysOverride"] as const) {
      const val = body[field];
      if (val !== undefined && val !== null) {
        if (
          typeof val !== "number" ||
          !Number.isFinite(val) ||
          val <= 0 ||
          !Number.isInteger(val)
        ) {
          errors[field] = `${field} must be a positive integer or null`;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new RouteValidationError(
        Object.values(errors)[0] ?? "Invalid body",
        { fieldErrors: errors },
      );
    }
    return body as unknown as PatchCampBody;
  },
};

export const PATCH = adminWrite<PatchCampBody, { campId: string }>({
  schema: patchCampSchema,
  revalidate: revalidateCampWrite,
  handle: async (ctx, body, _req, params) => {
    const result = await updateCamp(ctx.prisma, {
      campId: params.campId,
      patch: body,
    });
    return NextResponse.json(result);
  },
});

export const DELETE = adminWrite<unknown, { campId: string }>({
  revalidate: revalidateCampWrite,
  handle: async (ctx, _body, _req, params) => {
    const result = await deleteCamp(ctx.prisma, params.campId);
    return NextResponse.json(result);
  },
});
