/**
 * lib/domain/observations/is-camp-inspection.ts
 *
 * Issue #413 — single source of truth for "is this observation type a
 * camp-inspection write?". A camp-inspection write must invalidate the
 * `farm-<slug>-camps` cache tag in addition to the default
 * `observations` + `dashboard` tags, because cached camp-scoped fetchers
 * (e.g. `getCachedCampConditions`, `getCachedCampList`, and the
 * mode-independent dashboard counter from #414) derive their data from
 * the latest camp-inspection observation.
 *
 * Before this predicate existed, `observationWriteTags(slug)` returned
 * only `[observations, dashboard]`, so a camp_condition / camp_check
 * write left the camps tag stale until TTL — see issue #409 (and PRD
 * #412 for the staleness class).
 *
 * The set is REGISTRY-DERIVED and FROZEN — the call-site can iterate
 * but cannot mutate. The data flows: registry tuple → frozen Set →
 * predicate. To add a new camp-inspection type, extend the set below
 * (the registry is the type-system source of truth, this set is the
 * cache-coherence source of truth).
 */

import type { ObservationType } from "./registry";

/**
 * The observation types that imply a camp-inspection side-effect, i.e.
 * "the user just visited / scored / checked a camp", so any
 * camp-scoped cached read must be invalidated.
 *
 * The element type is pinned to `ObservationType` from the registry —
 * a typo like `"camp_conditon"` is a compile-time error. The Set
 * wrapper is `Object.freeze`d so callers cannot mutate the source of
 * truth at runtime.
 */
export const CAMP_INSPECTION_OBSERVATION_TYPES: ReadonlySet<ObservationType> =
  Object.freeze(
    new Set<ObservationType>(["camp_condition", "camp_check"]),
  );

/**
 * Pure predicate — `true` iff `type` is a registered camp-inspection
 * observation type.
 *
 * Defensive against runtime null/undefined: callers may pass
 * `body.type` (an `unknown` field on the wire) without prior
 * narrowing. The predicate never throws.
 */
export function isCampInspection(type: string): boolean {
  if (typeof type !== "string") return false;
  // `Set.has` accepts the broader string type via structural
  // compatibility — the cast keeps the public signature
  // `(string) => boolean` while delegating to the registry-typed Set.
  return CAMP_INSPECTION_OBSERVATION_TYPES.has(type as ObservationType);
}
