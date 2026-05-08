/**
 * Wave G2 (#166) — `lib/server/rotation-engine.ts` is now a re-export shim.
 *
 * The implementation moved to `lib/domain/rotation/get-status.ts` as part
 * of the ADR-0001 7/8 rollout. This shim keeps the four outside consumers
 * working without code changes:
 *
 *  - `lib/server/dashboard-alerts.ts`
 *  - `lib/server/cached.ts`
 *  - `app/[farmSlug]/tools/rotation-planner/page.tsx`
 *  - `app/[farmSlug]/admin/camps/[campId]/page.tsx`
 *
 * Plus existing test mocks in `__tests__/admin/species-filter-pages.test.tsx`
 * and `__tests__/perf/{multi-farm-cache,db-call-savings}.test.ts` that
 * `vi.mock('@/lib/server/rotation-engine', ...)` and only need the named
 * export `getRotationStatusByCamp` to keep resolving.
 *
 * New code should import from `@/lib/domain/rotation` (the barrel)
 * directly.
 */
export {
  getRotationStatusByCamp,
  type CampRotationStatus,
  type RotationMobSummary,
  type RotationPayload,
} from "@/lib/domain/rotation/get-status";
