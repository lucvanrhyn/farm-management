/**
 * Per-species + Active filter — single source of truth.
 *
 * Wave A2 (audit-2026-05-10) consolidated two divergent filter axes onto
 * this helper:
 *   - `components/dashboard/CampDetailPanel.tsx` previously fetched
 *     `/api/animals?camp=X&status=all` (no species, status disabled)
 *   - `app/[farmSlug]/admin/animals/page.tsx` previously did
 *     `findMany({ where: { species: mode } })` (no status filter)
 *
 * The user-facing semantic is uniform: per-species views show animals
 * matching the active mode AND status:Active. The cross-species "active head
 * of all species" total lives separately at the home hero.
 *
 * Centralising here means a future surface (mobs picker, vision logger
 * camp drilldown, etc.) gains the same defence by construction the moment
 * it adopts the helper, and a column-rename like `status` → `lifecycle`
 * needs one edit instead of N.
 */
import type { SpeciesId } from "@/lib/species/types";

/**
 * Literal value persisted by migrations 0007 / 0014 and read by every
 * surface that filters animals by lifecycle. Kept as a named constant so
 * grep-tooling and the parity test can reference one thing.
 */
export const ACTIVE_STATUS = "Active" as const;

/** Prisma `where` shape for `prisma.animal.findMany` on per-species views. */
export function activeSpeciesWhere(mode: SpeciesId): {
  readonly species: SpeciesId;
  readonly status: typeof ACTIVE_STATUS;
} {
  return { species: mode, status: ACTIVE_STATUS } as const;
}

/**
 * Query-string fragment for `/api/animals?...` on per-species views.
 * Returned WITHOUT a leading `?` or `&` so callers can compose freely.
 *
 * `status=Active` is sent explicitly rather than relying on the API default
 * so the URL is self-documenting and a future default-flip in the route
 * handler can't silently change client semantics.
 */
export function activeSpeciesQueryString(mode: SpeciesId): string {
  return `species=${encodeURIComponent(mode)}&status=${ACTIVE_STATUS}`;
}
