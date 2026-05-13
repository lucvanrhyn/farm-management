/**
 * GET  /api/observations — list observations (filterable, paginated).
 * POST /api/observations — log an observation (any authenticated tenant role).
 *
 * Wave C (#156) — adapter-only wiring. The hand-rolled handler shape is
 * gone; auth, body parse, typed-error envelope, and revalidate are owned
 * by the `tenantRead` / `tenantWrite` adapters from `lib/server/route/`.
 * The business logic lives in `lib/domain/observations/*`.
 *
 * Wire shapes:
 *   - GET  200 → `Observation[]` (raw Prisma rows)
 *   - POST 200 → `{ success: true, id: string }`
 *   - POST 422 → `{ error: "INVALID_TYPE" | "WRONG_SPECIES" | ... }`
 *   - POST 404 → `{ error: "CAMP_NOT_FOUND" }`
 *   - POST 400 → `{ error: "INVALID_TIMESTAMP" }` or `VALIDATION_FAILED`
 *   - POST 429 → `{ error: "Too many requests" }` (rate-limit, transport-only)
 */
import { NextResponse } from "next/server";

import { tenantRead, tenantWrite, RouteValidationError, routeError } from "@/lib/server/route";
import { revalidateObservationWrite } from "@/lib/server/revalidate";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createObservation,
  listObservations,
  type CreateObservationInput,
} from "@/lib/domain/observations";
import {
  validateReproductiveState,
  ReproMultiStateError,
  ReproRequiredError,
} from "@/lib/server/validators/reproductive-state";
import {
  validateDeathObservation,
  DeathMultiCauseError,
  DeathDisposalRequiredError,
} from "@/lib/server/validators/death";

interface CreateObservationBody {
  type: string;
  camp_id: string;
  animal_id?: string | null;
  details?: string | null;
  created_at?: string | null;
  /**
   * Issue #206 — client-generated idempotency key. Optional on the wire
   * (back-compat for pre-#206 clients), but the new logger UI populates it
   * via `crypto.randomUUID()` at form mount so retries collapse to one row.
   */
  clientLocalId?: string | null;
}

const createObservationSchema = {
  parse(input: unknown): CreateObservationBody {
    const body = (input ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    if (typeof body.type !== "string" || !body.type) {
      errors.type = "type is required";
    }
    if (typeof body.camp_id !== "string" || !body.camp_id) {
      errors.camp_id = "camp_id is required";
    }
    if (Object.keys(errors).length > 0) {
      throw new RouteValidationError(
        Object.values(errors)[0] ?? "Invalid body",
        { fieldErrors: errors },
      );
    }
    return body as unknown as CreateObservationBody;
  },
};

export const GET = tenantRead({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const result = await listObservations(ctx.prisma, {
      camp: searchParams.get("camp"),
      type: searchParams.get("type"),
      animalId: searchParams.get("animalId"),
      limit: parseInt(searchParams.get("limit") ?? "50", 10),
      offset: parseInt(searchParams.get("offset") ?? "0", 10),
    });
    return NextResponse.json(result);
  },
});

export const POST = tenantWrite<CreateObservationBody>({
  schema: createObservationSchema,
  revalidate: revalidateObservationWrite,
  handle: async (ctx, body) => {
    // Rate limit: 100 observations per minute per user. Transport-only —
    // offline sync can burst, but cap runaway clients.
    const userId = ctx.session.user?.email ?? "unknown";
    const rl = checkRateLimit(`observations:${userId}`, 100, 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Wave 1 / #253 — ReproductiveStateValidator. Defends against the
    // "user toggled In Heat + Pregnant simultaneously" silent-data-loss
    // path the 2026-05-13 stress test surfaced. The validator is a no-op
    // for non-reproductive `type`s, so death (Wave 2), weighing, treatment
    // etc. flow through unchanged. See `lib/server/validators/reproductive-state.ts`
    // for the full state-counting contract.
    try {
      validateReproductiveState(body.type, body.details ?? null);
    } catch (err) {
      if (err instanceof ReproMultiStateError || err instanceof ReproRequiredError) {
        return routeError(err.code, err.message, 422);
      }
      throw err;
    }

    // Wave 3b / #254 — `validateDeathObservation`. Symmetric with the
    // reproductive validator above: locks out the silent-multi-cause path
    // and the SARS / NSPCA-required `carcassDisposal` field. The validator
    // is gated externally on `body.type === 'death'` (vs. the reproductive
    // validator which gates internally) so its public surface is a pure
    // details-payload check — see `lib/server/validators/death.ts` for the
    // scope-discipline rationale.
    if (body.type === "death") {
      try {
        validateDeathObservation(body.details ?? null);
      } catch (err) {
        if (
          err instanceof DeathMultiCauseError ||
          err instanceof DeathDisposalRequiredError
        ) {
          return routeError(err.code, err.message, 422);
        }
        throw err;
      }
    }

    const input: CreateObservationInput = {
      type: body.type,
      camp_id: body.camp_id,
      animal_id: body.animal_id ?? null,
      details: body.details ?? "",
      created_at: body.created_at ?? null,
      loggedBy: ctx.session.user?.email ?? null,
      // Issue #206 — forward the client UUID into the domain op so the upsert
      // path activates. Falsy values (null, empty string) fall through to the
      // legacy create path, preserving back-compat.
      clientLocalId: body.clientLocalId ?? null,
    };
    const result = await createObservation(ctx.prisma, input);
    return NextResponse.json(result);
  },
});
