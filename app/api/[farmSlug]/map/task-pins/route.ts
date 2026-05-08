/**
 * GET /api/[farmSlug]/map/task-pins?status=today|open|all — GeoJSON
 * FeatureCollection of Task Point features. See `listTaskPins` for the
 * coordinate-resolution + status-filter rules.
 *
 * Wave G3 (#167) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation:
 *   - 200 GeoJSON FeatureCollection unchanged (delegates to
 *     `listTaskPins` from the map domain barrel).
 *   - 400 INVALID_STATUS_FILTER preserved (same code, same status, same
 *     message) for an unknown `?status=` value. Re-emitted via the
 *     adapter's `routeError` helper so the envelope matches the rest of
 *     the surface.
 *   - 401 / 403 envelopes migrate from the per-route hand-rolled
 *     `{ success: false, error: CODE, message }` to the adapter's
 *     canonical `{ error: "AUTH_REQUIRED" | ..., message }` — same
 *     SCREAMING_SNAKE codes, same HTTP statuses.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug, routeError } from "@/lib/server/route";
import { listTaskPins, type TaskPinStatusFilter } from "@/lib/domain/map";

export const dynamic = "force-dynamic";

const VALID_STATUS_FILTERS = new Set<TaskPinStatusFilter>([
  "today",
  "open",
  "all",
]);

function isValidStatusFilter(value: string): value is TaskPinStatusFilter {
  return VALID_STATUS_FILTERS.has(value as TaskPinStatusFilter);
}

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req) => {
    const statusFilter = new URL(req.url).searchParams.get("status") ?? "open";
    if (!isValidStatusFilter(statusFilter)) {
      return routeError(
        "INVALID_STATUS_FILTER",
        "status must be one of: today, open, all",
        400,
      );
    }
    const payload = await listTaskPins(ctx.prisma, statusFilter);
    return NextResponse.json(payload);
  },
});
