// components/admin/ObservationsLog.tsx
// Admin observations timeline. Filters → paginated list → Edit modal.
//
// Implementation lives under `components/admin/observations-log/`:
//   constants.ts         — vocab arrays, badges, styles, EDITABLE_TYPES
//   parseDetails.ts      — pure summary-line builder (re-exported below)
//   fields.tsx           — per-type input components + TypeFields dispatch
//   EditModal.tsx        — single-observation edit/delete modal
//   Filters.tsx          — camp + type filter selects
//   ObservationRow.tsx   — single timeline entry
//   Pagination.tsx       — Previous / Next strip

"use client";

import { useState, useEffect, useCallback } from "react";
import type { Camp, ObservationType, PrismaObservation } from "@/lib/types";
import { clientLogger } from "@/lib/client-logger";
import { useFarmModeSafe } from "@/lib/farm-mode";
import { PAGE_SIZE } from "./observations-log/constants";
import { EditModal } from "./observations-log/EditModal";
import { Filters } from "./observations-log/Filters";
import { ObservationRow } from "./observations-log/ObservationRow";
import { Pagination } from "./observations-log/Pagination";

// Re-export for tests / external callers that import { parseDetails } from this module.
export { parseDetails } from "./observations-log/parseDetails";

interface ObservationsLogProps {
  onDeleted?: () => void;
  /**
   * Issue #496 — SSR-resolved active farm-mode species (the page server
   * component reads `getFarmMode(farmSlug)` and threads it down, same source
   * the create-modal + AnimalsTable already use). When the tenant is genuinely
   * multi-species AND this is a concrete species, the timeline requests the
   * species-aware `/api/observations?species=<active>` so a mixed-species
   * tenant only sees the active species' rows (#491 made the param OPT-IN).
   *
   * On a single-species tenant — or when this is absent ("all" / unknown mode)
   * — the `?species` param is OMITTED so the endpoint stays the cross-species
   * rollup (#356 invariant) and behaviour is unchanged.
   */
  species?: string | null;
}

export default function ObservationsLog({ onDeleted, species }: ObservationsLogProps) {
  // Only narrow on a genuinely multi-species tenant: a single-species farm's
  // sole species already equals the cross-species set, so omitting `?species`
  // returns identical rows while preserving the default cross-species path.
  const { isMultiMode } = useFarmModeSafe();
  const activeSpecies = isMultiMode && species ? species : null;
  const [camps, setCamps] = useState<Camp[]>([]);
  const [campFilter, setCampFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<ObservationType | "all">("all");
  const [page, setPage] = useState(1);
  const [observations, setObservations] = useState<PrismaObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [editTarget, setEditTarget] = useState<PrismaObservation | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/camps", { signal: controller.signal })
      .then((r) => r.ok ? r.json() : [])
      .then((data: Camp[]) => setCamps(data))
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") {
          clientLogger.error("[ObservationsLog] Failed to load camps", { err });
        }
      });
    return () => controller.abort();
  }, []);

  const fetchObs = useCallback(async (campVal: string, typeVal: string, pageVal: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (campVal !== "all") params.set("camp", campVal);
    if (typeVal !== "all") params.set("type", typeVal);
    // Issue #496 — opt-in species narrowing. Only set when the tenant is
    // multi-species and a concrete active species is known; otherwise omitted
    // so the cross-species rollup (#356) is preserved.
    if (activeSpecies) params.set("species", activeSpecies);
    params.set("limit", String(PAGE_SIZE + 1));
    params.set("offset", String((pageVal - 1) * PAGE_SIZE));

    try {
      const res = await fetch(`/api/observations?${params.toString()}`);
      if (!res.ok) { setObservations([]); return; }
      const data: PrismaObservation[] = await res.json();
      setHasMore(data.length > PAGE_SIZE);
      setObservations(data.slice(0, PAGE_SIZE));
    } catch {
      setObservations([]);
    } finally {
      setLoading(false);
    }
  }, [activeSpecies]);

  useEffect(() => {
    fetchObs(campFilter, typeFilter, page);
  }, [campFilter, typeFilter, page, fetchObs]);

  function handleFilterChange(newCamp: string, newType: ObservationType | "all") {
    setCampFilter(newCamp);
    setTypeFilter(newType);
    setPage(1);
  }

  function handleSaved(updated: PrismaObservation) {
    setObservations((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }

  function handleDeleted(id: string) {
    setObservations((prev) => prev.filter((o) => o.id !== id));
    onDeleted?.();
  }

  return (
    <>
      {editTarget && (
        <EditModal
          obs={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}

      <div className="flex flex-col gap-4">
        <Filters
          camps={camps}
          campFilter={campFilter}
          typeFilter={typeFilter}
          loading={loading}
          onChange={handleFilterChange}
        />

        {/* Timeline list */}
        <div
          className="rounded-2xl px-6 py-4"
          style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
        >
          {!loading && observations.length === 0 && (
            <p className="text-center py-10 text-sm" style={{ color: "var(--ft-subtle)" }}>
              No observations found.
            </p>
          )}
          <div className="flex flex-col" style={{ borderLeft: "2px solid var(--ft-border)", marginLeft: "5px" }}>
            {observations.map((obs) => (
              <ObservationRow key={obs.id} obs={obs} onEdit={setEditTarget} />
            ))}
          </div>
        </div>

        <Pagination
          page={page}
          hasMore={hasMore}
          loading={loading}
          onPageChange={setPage}
        />
      </div>
    </>
  );
}
