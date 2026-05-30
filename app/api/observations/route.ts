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

import { tenantRead, tenantWrite, RouteValidationError } from "@/lib/server/route";
import { revalidateObservationWrite } from "@/lib/server/revalidate";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createObservation,
  listObservations,
  OBSERVATIONS_DEFAULT_LIMIT,
  OBSERVATIONS_MAX_LIMIT,
  type CreateObservationInput,
} from "@/lib/domain/observations";
import { parseLimit } from "@/lib/domain/shared/limit";

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
  /**
   * Issue #492 (PRD #479 backlog) — optional first-class free-text note
   * (Path A). Independent of the `details` JSON contract; forwarded straight
   * into the create door, which sanitises + persists it onto the `notes`
   * column. Rejected at this boundary as `VALIDATION_FAILED` when not a
   * string and as `NOTE_TOO_LONG` (in the door) when over the length cap.
   */
  notes?: string | null;
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
    // Issue #484 — `details` is persisted into a NON-NULLABLE `String`
    // Prisma column via `details ?? ""`. A non-string (object / number /
    // array / boolean) would otherwise sail past this schema and throw a
    // PrismaClientValidationError → 500. Reject it at the boundary as a
    // typed 400. `undefined` / `null` stay valid (they default to `""`).
    if (body.details != null && typeof body.details !== "string") {
      errors.details = "details must be a string";
    }
    // Issue #492 — `notes` is an OPTIONAL free-text string, independent of the
    // #484 `details` contract. A non-string (object / number / boolean) would
    // sail past into the create door's `String?` column and throw a
    // PrismaClientValidationError → 500. Reject it here as a typed 400.
    // `undefined` / `null` stay valid (they normalise to null in the door).
    // The length cap is enforced authoritatively in the door (NOTE_TOO_LONG)
    // — this boundary only shape-checks the type.
    if (body.notes != null && typeof body.notes !== "string") {
      errors.notes = "notes must be a string";
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
    // Issue #485 — validate `?limit` at the boundary via the shared
    // `parseLimit`. A non-finite / ≤0 limit now throws `InvalidLimitError`
    // → `{ error: "INVALID_LIMIT" }` 400 (mapped by the `tenantRead`
    // adapter), converging this endpoint on the animals + tasks contract.
    // Previously `listObservations` SILENTLY clamped a bad limit to the
    // default 50 — that silent path is the bug #485 closes. An omitted
    // `?limit` still falls back to 50; a valid value still clamps to 200.
    const limit = parseLimit(searchParams.get("limit"), {
      max: OBSERVATIONS_MAX_LIMIT,
      fallback: OBSERVATIONS_DEFAULT_LIMIT,
    });
    const result = await listObservations(ctx.prisma, {
      camp: searchParams.get("camp"),
      type: searchParams.get("type"),
      animalId: searchParams.get("animalId"),
      // Issue #491 — OPT-IN species narrowing, mirroring `/api/animals`. When
      // omitted the op stays the cross-species rollup (#356 invariant); the
      // predicate is applied only when the param is present.
      species: searchParams.get("species"),
      limit,
      offset: parseInt(searchParams.get("offset") ?? "0", 10),
    });
    return NextResponse.json(result);
  },
});

export const POST = tenantWrite<CreateObservationBody>({
  schema: createObservationSchema,
  // Issue #413 — `revalidate` is called manually inside `handle` (see the
  // post-`createObservation` block below) so it can pass the observation
  // type as the second arg of `revalidateObservationWrite(slug, type)`.
  // The adapter-level `revalidate` hook only receives `slug`, so it
  // cannot thread the camp_condition / camp_check distinction needed
  // to invalidate the `farm-<slug>-camps` tag. Doing the call inline
  // keeps the contract race-free and explicit.
  handle: async (ctx, body) => {
    // Rate limit: 100 observations per minute per user. Transport-only —
    // offline sync can burst, but cap runaway clients.
    const userId = ctx.session.user?.email ?? "unknown";
    const rl = checkRateLimit(`observations:${userId}`, 100, 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // ADR-0007 (#513) — per-type `details` validation (reproductive state +
    // death single-cause/disposal, plus weighing + camp_condition) is no longer
    // performed here. It moved INTO the write door (`createObservation` →
    // `validateObservationDetails`), so EVERY observation-write entry point —
    // this route, `move-mob`, and `update-task` (ADR-0006's other door callers)
    // — is validated identically. The door throws the same typed errors
    // (`Death*`, `Repro*`, `WeightOutOfRangeError`, `CampConditionFieldRequiredError`)
    // and the `tenantWrite` adapter maps them to their byte-identical 422
    // envelopes via `mapApiDomainError`.
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
      // Issue #492 — forward the optional free-text note. The door sanitises
      // (trim + cap) and writes it onto the CREATE side of the upsert only.
      notes: body.notes ?? null,
    };
    const result = await createObservation(ctx.prisma, input);
    // Issue #413 — invalidate camp-scoped caches on camp_condition /
    // camp_check writes. Inline because the adapter-level revalidate
    // hook only receives `slug` and cannot thread the wire type.
    revalidateObservationWrite(ctx.slug, body.type);
    return NextResponse.json(result);
  },
});
