/**
 * Wave G3 (#167) — public surface of the map domain ops.
 *
 * Each op is a pure function on `(prisma, ...)` that returns a plain
 * GeoJSON `FeatureCollection`. The transport adapter (`tenantReadSlug`)
 * wires these into the four `app/api/[farmSlug]/map/**` GET routes.
 *
 * These are pure read endpoints — the only failure paths are auth/scope,
 * which the adapter already handles via `getFarmContextForSlug`. No typed
 * domain errors are needed.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-167-map.md`.
 */
export { listInfrastructure } from "./list-infrastructure";
export { listRainfallGauges } from "./list-rainfall-gauges";
export { listTaskPins, type TaskPinStatusFilter } from "./list-task-pins";
export { listWaterPoints } from "./list-water-points";

export type {
  GeoJsonFeatureCollection,
  GeoJsonFeature,
  GeoJsonPoint,
} from "./types";
