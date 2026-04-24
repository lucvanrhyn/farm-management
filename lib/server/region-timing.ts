/**
 * Server-Timing helper for Phase E: tags each request with which Turso region
 * served the farm DB query.
 *
 * Format: emits `db-region-<code>;dur=1` (dur=1 is a marker — the value is
 * purely for Server-Timing syntax conformance; only the label matters).
 * The bench harness and Lighthouse CI can grep for `db-region-*` to verify
 * every request is being served from `fra` post-cutover, or spot a farm
 * that's still on the legacy primary mid-migration.
 *
 * Zero-overhead when no timing bag is active (inherits the short-circuit
 * from `recordTiming`).
 */

import { recordTiming } from "@/lib/server/server-timing";
import { parseTursoRegion } from "@/lib/turso-region";

export function recordFarmDbRegion(tursoUrl: string): void {
  const region = parseTursoRegion(tursoUrl);
  const label = region ? `db-region-${region}` : "db-region-unknown";
  recordTiming(label, 1);
}
