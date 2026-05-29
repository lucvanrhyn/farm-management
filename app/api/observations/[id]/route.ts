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
  /**
   * Issue #492 (PRD #479 backlog) — optional edit to the free-text `notes`
   * column. OMITTED leaves the column untouched; present (string or explicit
   * null) is forwarded to the edit door, which sanitises + persists it. The
   * `notesProvided` flag distinguishes "absent" from "explicit null" so a
   * details-only edit never clobbers an existing note.
   */
  notes?: string | null;
  notesProvided: boolean;
}

const patchObservationSchema = {
  parse(input: unknown): PatchObservationBody {
    const body = (input ?? {}) as Record<string, unknown>;
    if (typeof body.details !== "string") {
      throw new RouteValidationError("details must be a JSON string", {
        fieldErrors: { details: "details must be a JSON string" },
      });
    }
    // Issue #492 — `notes`, when present, must be a string (or explicit null
    // to clear). The length cap is enforced authoritatively in the edit door
    // (NOTE_TOO_LONG); this boundary only shape-checks the type.
    const notesProvided = "notes" in body;
    if (notesProvided && body.notes != null && typeof body.notes !== "string") {
      throw new RouteValidationError("notes must be a string", {
        fieldErrors: { notes: "notes must be a string" },
      });
    }
    return {
      details: body.details,
      ...(notesProvided ? { notes: body.notes as string | null } : {}),
      notesProvided,
    };
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
      // Issue #492 — forward `notes` ONLY when the caller supplied it, so a
      // details-only PATCH leaves the column untouched. The door sanitises +
      // caps; an explicit null clears the note.
      ...(body.notesProvided ? { notes: body.notes ?? null } : {}),
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
