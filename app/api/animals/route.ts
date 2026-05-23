import { NextResponse } from "next/server";
import { tenantRead, tenantWrite } from "@/lib/server/route";
import { mapApiDomainError } from "@/lib/server/api-errors";
import { revalidateAnimalWrite } from "@/lib/server/revalidate";
import {
  createAnimal,
  CreateAnimalValidationError,
} from "@/lib/domain/animals/create-animal";
import { listAnimals } from "@/lib/domain/animals/list-animals";

// Pagination tunables. Default 500/request balances payload size (~100KB JSON
// for a typical cattle row) against round-trip count on large herds. Max
// 2000 caps the worst-case single-request cost when a mis-coded client asks
// for "all at once".
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/**
 * GET /api/animals
 *
 * Hotfix P0.1 (2026-05-03) — typed-error wrapper. The previous handler had
 * NO try/catch around `prisma.animal.findMany()`. Any libSQL/Prisma throw
 * (token expiry, schema drift on a stale cached client per
 * `feedback-vercel-cached-prisma-client.md`, connection reset) became a
 * Next.js default 500 with an empty body. That cascaded into 11 broken
 * admin pages + zero-animals on every per-camp logger page on prod.
 *
 * Wave A migration moves that try/catch into the `tenantRead` adapter — any
 * throw inside `handle` produces the same typed envelope
 * `{ error: "DB_QUERY_FAILED", message }` at status 500, so the wire is
 * unchanged but every other GET in the codebase gains the same defence by
 * construction. The per-route `dbQueryFailed` helper that lived here is
 * deleted in this commit.
 *
 * Wave 316b (#309) — the fat handler body (baseWhere construction, the
 * unbounded vs cursor `findMany` split, hasMore/nextCursor) moved into the
 * `listAnimals` domain op. The route is now a thin adapter: it parses query
 * params, keeps the `{ error: "Invalid limit" }` 400 at the boundary
 * (legacy sync-manager clients pattern-match the literal — migrating it to
 * a typed envelope is a deferred future wave), then maps the op's
 * discriminated result back to the byte-identical legacy wire (bare array
 * in unbounded mode, `{ items, nextCursor, hasMore }` in cursor mode). The
 * discriminator never reaches the client.
 */
export const GET = tenantRead({
  handle: async (ctx, req) => {
    const { prisma } = ctx;
    const { searchParams } = new URL(req.url);
    const camp = searchParams.get("camp");
    const category = searchParams.get("category");
    const status = searchParams.get("status") ?? "Active";
    const species = searchParams.get("species");
    // Phase I.2: free-text search (ID or name contains) and `unassigned=1`
    // toggle. These power the client-side "add animal to mob" picker so the
    // mobs admin page no longer SSRs the full active roster.
    const search = searchParams.get("search")?.trim() ?? "";
    const unassigned = searchParams.get("unassigned") === "1";

    // Pagination is opt-in. When neither `limit` nor `cursor` is present, the
    // handler returns the unbounded array shape so existing callers (NVD
    // picker, per-camp drill-down) don't break. The sync-manager and any
    // future bulk caller passes `?limit=` to receive `{ items, nextCursor }`
    // instead. On a large herd this lets the client stream batches rather
    // than blocking on a single multi-MB JSON parse.
    const limitParam = searchParams.get("limit");
    const cursorParam = searchParams.get("cursor");
    const paginated = limitParam !== null || cursorParam !== null;

    let limit: number | undefined;
    if (paginated) {
      const rawLimit = limitParam
        ? Number.parseInt(limitParam, 10)
        : DEFAULT_LIMIT;
      if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
        // Pre-existing wire shape for query-param validation:
        // `{ error: "Invalid limit" }`. Kept here at the route boundary
        // (NOT routed through `routeError`, NOT a domain error) because the
        // legacy clients (sync-manager) pattern-match on the message. A
        // future wave can switch this to a typed VALIDATION_FAILED envelope
        // alongside a client-side flip.
        return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
      }
      limit = Math.min(rawLimit, MAX_LIMIT);
    }

    const result = await listAnimals(prisma, {
      camp,
      category,
      status,
      species,
      search,
      unassigned,
      paginated,
      limit,
      cursor: cursorParam,
    });

    // Map the discriminated result back to the byte-identical legacy wire.
    // The discriminator never reaches the client: unbounded mode is a bare
    // array, cursor mode is `{ items, nextCursor, hasMore }`.
    if (result.mode === "all") {
      return NextResponse.json(result.animals);
    }
    return NextResponse.json({
      items: result.items,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  },
});

/**
 * POST /api/animals
 *
 * tenantWrite (not adminWrite): LOGGER role may create calf records via the
 * calving-observation flow; ADMIN may create any animal. We can't use the
 * pure adminWrite gate here, so we use tenantWrite and forward the caller's
 * role to `createAnimal`.
 *
 * Wave 316b (#309) — the in-handler role gate moved INTO `createAnimal` (it
 * throws `AnimalRoleForbiddenError` for a non-ADMIN/non-LOGGER role). The
 * route is now a thin adapter: it always passes `role: ctx.role`, and maps
 * the typed error onto the byte-identical legacy 403 via
 * `mapApiDomainError` (which re-mints the exact `routeError("FORBIDDEN",
 * "Forbidden", 403)` envelope). `CreateAnimalValidationError` → 400 stays
 * unchanged.
 */
export const POST = tenantWrite<unknown>({
  revalidate: revalidateAnimalWrite,
  handle: async (ctx, body) => {
    const { prisma, role } = ctx;

    const {
      animalId,
      name,
      sex,
      dateOfBirth,
      breed,
      category,
      currentCamp,
      status,
      motherId,
      fatherId,
      species,
      tagNumber,
      brandSequence,
      clientLocalId,
    } = (body ?? {}) as Record<string, unknown>;

    // Issue #207 — domain extraction. Validation + persistence now live in
    // `lib/domain/animals/create-animal.ts` (mirrors the #206 / PR #214
    // extraction of `createObservation`). The route is a thin adapter that
    // forwards the parsed body and the optional `clientLocalId` idempotency
    // key, then maps `CreateAnimalValidationError` onto the legacy 400
    // envelope so existing clients (admin form, sync-manager retry path)
    // see the same wire shape.
    try {
      const result = await createAnimal(prisma, {
        animalId: animalId as string,
        name: (name as string | undefined) ?? null,
        sex: sex as string,
        dateOfBirth: (dateOfBirth as string | undefined) ?? null,
        breed: breed as string | undefined,
        category: category as string,
        currentCamp: currentCamp as string,
        status: status as string | undefined,
        motherId: (motherId as string | undefined) ?? null,
        fatherId: (fatherId as string | undefined) ?? null,
        species: species as string | undefined,
        tagNumber: tagNumber as string | null | undefined,
        brandSequence: brandSequence as string | null | undefined,
        // Issue #207 — forward the client UUID so the upsert path activates.
        // Falsy values (null, empty string) fall through to the legacy create
        // path, preserving back-compat for pre-#207 clients.
        clientLocalId:
          typeof clientLocalId === "string" && clientLocalId
            ? clientLocalId
            : null,
        // Wave 316b (#309) — role gate now lives in the domain op.
        role,
      });

      return NextResponse.json(
        { success: true, animal: result.animal },
        { status: 201 },
      );
    } catch (err) {
      if (err instanceof CreateAnimalValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      // Wave 316b (#309) — `AnimalRoleForbiddenError` maps to the
      // byte-identical legacy 403 via the shared domain-error mapper (it
      // re-mints the exact `routeError("FORBIDDEN", "Forbidden", 403)`).
      const mapped = mapApiDomainError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
});
