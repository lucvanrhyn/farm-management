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
import { PAGE_SIZE } from "./observations-log/constants";
import { EditModal } from "./observations-log/EditModal";
import { Filters } from "./observations-log/Filters";
import { ObservationRow } from "./observations-log/ObservationRow";
import { Pagination } from "./observations-log/Pagination";

// Re-export for tests / external callers that import { parseDetails } from this module.
export { parseDetails } from "./observations-log/parseDetails";

interface ObservationsLogProps {
  onDeleted?: () => void;
}

export default function ObservationsLog({ onDeleted }: ObservationsLogProps) {
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
          // intentional console: client-side fetch, no logger sink in browser.
          console.error("[ObservationsLog] Failed to load camps:", err);
        }
      });
    return () => controller.abort();
  }, []);

  const fetchObs = useCallback(async (campVal: string, typeVal: string, pageVal: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (campVal !== "all") params.set("camp", campVal);
    if (typeVal !== "all") params.set("type", typeVal);
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
  }, []);

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
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          {!loading && observations.length === 0 && (
            <p className="text-center py-10 text-sm" style={{ color: "#9C8E7A" }}>
              No observations found.
            </p>
          )}
          <div className="flex flex-col" style={{ borderLeft: "2px solid #E0D5C8", marginLeft: "5px" }}>
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
