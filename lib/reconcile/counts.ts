/**
 * Animal/camp count reconciliation — PRD #128 stress test, issue #135 gap #3.
 *
 * The PRD #128 incident (2026-05-06): home screen reported `874 animals /
 * 19 camps` while the admin overview reported `0 animals / 0 camps` for the
 * same tenant in the same session. The two count sources had silently
 * drifted; nothing in CI compared them.
 *
 * This module is the **shared invariant**. The same arithmetic that the
 * count-reconciliation integration test runs at unit-time is now available
 * to runtime probes (`/api/_internal/synthetic-probe`, the post-promote
 * gate, ad-hoc ops scripts) without duplicating the rule. If the formula
 * ever needs to change (e.g. accounting for archived animals), one edit
 * here updates every caller.
 *
 * Why a tiny module instead of inline arithmetic
 * ──────────────────────────────────────────────
 * Three independent caller types need the SAME divergence rule:
 *   - the unit test that pinned the bug (see the integration test file)
 *   - the synthetic probe endpoint (incoming gap #4)
 *   - the post-merge-promote workflow's count-sanity check
 *
 * Inline implementations drift. A shared module makes drift impossible:
 * change the rule, every caller picks it up.
 */

/** A row shape that exposes the per-camp animal count. */
export interface CampWithAnimalCount {
  /** Snake-case key matching `/api/camps` response shape. Nullable for safety. */
  animal_count?: number | null;
}

export interface ReconcileReport {
  /** Animal count reported by the farm-level source of truth (`SELECT COUNT(*) FROM Animal`). */
  farmCount: number;
  /** Sum of every camp's per-camp animal_count. Should equal `farmCount`. */
  summedCount: number;
  /**
   * Signed divergence: `summedCount - farmCount`. Zero means the two sources
   * agree; a non-zero value names the magnitude AND direction of the drift,
   * which is more diagnostic than `abs(diff)` for ops triage.
   */
  divergence: number;
  /** `divergence === 0`. Convenience for `if (!ok) page.alert(...)`. */
  ok: boolean;
  /** Per-camp count for the camp-list-vs-summary check (a separate divergence). */
  campCount: number;
}

export interface ReconcileInput {
  /** The "official" animal count from the source-of-truth query. */
  farmAnimalCount: number;
  /** Per-camp animal counts (each camp's `animal_count` field). */
  campAnimalCounts: ReadonlyArray<number>;
}

/**
 * Compute the reconcile report from raw counts.
 *
 * Pure function — no I/O, no allocations beyond the result object. Safe to
 * call in any context (server component, API route, integration test).
 */
export function reconcileCounts(input: ReconcileInput): ReconcileReport {
  const summedCount = input.campAnimalCounts.reduce((acc, n) => acc + (n ?? 0), 0);
  const divergence = summedCount - input.farmAnimalCount;
  return {
    farmCount: input.farmAnimalCount,
    summedCount,
    divergence,
    ok: divergence === 0,
    campCount: input.campAnimalCounts.length,
  };
}

/**
 * Sugar: reconcile from an animals array + a camps array. The animals
 * array is only used for its `.length` (the farm's source-of-truth count
 * is just the row count). The camps array is mapped through to its
 * `animal_count` field.
 *
 * The synthetic probe (gap #4) will use this entry point — it has both
 * arrays in scope and shouldn't have to compute summed counts itself.
 */
export function reconcileFromArrays(
  animals: ReadonlyArray<unknown>,
  camps: ReadonlyArray<CampWithAnimalCount>,
): ReconcileReport {
  return reconcileCounts({
    farmAnimalCount: animals.length,
    campAnimalCounts: camps.map((c) => c.animal_count ?? 0),
  });
}
