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
  // Issue #413 — revalidate is invoked inline so it can thread the
  // affected row's `type` into `revalidateObservationWrite(slug, type)`,
  // adding the `farm-<slug>-camps` tag for camp_condition / camp_check
  // edits. The adapter-level hook only sees `slug`.
  handle: async (ctx, body, _req, params) => {
    const updated = await updateObservation(ctx.prisma, {
      id: params.id,
      details: body.details,
      editedBy: ctx.session.user?.email ?? null,
    });
    revalidateObservationWrite(ctx.slug, updated.type);
    return NextResponse.json(updated);
  },
});

export const DELETE = adminWrite<unknown, { id: string }>({
  // Issue #413 — fetch the row's `type` BEFORE delete so we can thread
  // it into `revalidateObservationWrite(slug, type)` and invalidate
  // the `farm-<slug>-camps` tag when the row being deleted is a
  // camp_condition / camp_check.
  handle: async (ctx, _body, _req, params) => {
    const existing = await ctx.prisma.observation.findUnique({
      where: { id: params.id },
      select: { type: true },
    });
    const result = await deleteObservation(ctx.prisma, params.id);
    revalidateObservationWrite(ctx.slug, existing?.type ?? null);
    return NextResponse.json(result);
  },
});
