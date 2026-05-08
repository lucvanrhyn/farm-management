/**
 * Wave G4 (#168) — public surface of the performance domain ops.
 *
 * Each op is a pure function on `(prisma, ...)` returning JSON-serialisable
 * data. The transport adapter (`tenantReadSlug`) wires this into the
 * `/api/[farmSlug]/performance` route handler.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-168-analytics.md`.
 */
export {
  listCampPerformance,
  type CampPerformanceRow,
} from "./list-camp-performance";
