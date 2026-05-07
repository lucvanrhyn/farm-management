/**
 * PATCH  /api/observations/[id] — edit an observation's `details` payload.
 * DELETE /api/observations/[id] — delete an observation row.
 *
 * Wave C (#156) — adapter-only wiring. Both endpoints are ADMIN-gated.
 * Business logic lives in `lib/domain/observations/{update,delete}-observation.ts`.
 *
 * Wire shapes:
 *   - PATCH 200  → updated `Observation` row
 *   - PATCH 404  → `{ error: "OBSERVATION_NOT_FOUND" }`
 *   - PATCH 400  → `{ error: "VALIDATION_FAILED" }` (details must be string)
 *   - DELETE 200 → `{ success: true }`
 *   - DELETE 404 → `{ error: "OBSERVATION_NOT_FOUND" }`
 */
import { NextResponse } from "next/server";

import { adminWrite, RouteValidationError } from "@/lib/server/route";
import { revalidateObservationWrite } from "@/lib/server/revalidate";
import {
  deleteObservation,
  updateObservation,
} from "@/lib/domain/observations";

interface PatchObservationBody {
  details: string;
}

const patchObservationSchema = {
  parse(input: unknown): PatchObservationBody {
    const body = (input ?? {}) as Record<string, unknown>;
    if (typeof body.details !== "string") {
      throw new RouteValidationError("details must be a JSON string", {
        fieldErrors: { details: "details must be a JSON string" },
      });
    }
    return { details: body.details };
  },
};

export const PATCH = adminWrite<PatchObservationBody, { id: string }>({
  schema: patchObservationSchema,
  revalidate: revalidateObservationWrite,
  handle: async (ctx, body, _req, params) => {
    const updated = await updateObservation(ctx.prisma, {
      id: params.id,
      details: body.details,
      editedBy: ctx.session.user?.email ?? null,
    });
    return NextResponse.json(updated);
  },
});

export const DELETE = adminWrite<unknown, { id: string }>({
  revalidate: revalidateObservationWrite,
  handle: async (ctx, _body, _req, params) => {
    const result = await deleteObservation(ctx.prisma, params.id);
    return NextResponse.json(result);
  },
});
