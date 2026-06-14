"use client";

import { useState, useCallback } from "react";
import CreateObservationModal from "@/components/admin/CreateObservationModal";
import SheepObservationsTimeline from "./SheepObservationsTimeline";

interface Props {
  camps: { id: string; name: string }[];
  animals: { id: string; tag: string; campId: string }[];
  /**
   * Active species for this page (hard-coded "sheep" at the page boundary
   * per ADR-0003). Forwarded to the create-observation modal so its
   * server-side animal picker filters to sheep regardless of the cookie.
   */
  species: "sheep";
}

/**
 * Sheep observations page client — owns the "+ New Entry" button, the
 * create-observation modal, AND the visible timeline.
 *
 * #496 — the timeline (`SheepObservationsTimeline`) now consumes the
 * species-aware `/api/observations?species=sheep` endpoint client-side
 * (migrated off the SSR facade). Mirroring the cattle
 * `ObservationsPageClient` → `ObservationsLog` pattern, this client owns a
 * `refreshKey`: a successful create bumps it, remounting/refetching the
 * timeline so the new row appears — no `router.refresh()` round-trip needed.
 */
export default function SheepObservationsPageClient({ camps, animals, species }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // On successful create, bump the refresh key so the client timeline
  // re-fetches and the new row is painted. Mirrors the cattle page's
  // `refreshKey` bump on `ObservationsPageClient`.
  const refresh = useCallback(() => {
    setShowCreate(false);
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <>
      <div className="mb-4">
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-semibold rounded-xl transition-colors"
          style={{ background: "var(--ft-good)", color: "var(--ft-fair-bg)" }}
        >
          + New Entry
        </button>
      </div>

      {showCreate && (
        <CreateObservationModal
          camps={camps}
          animals={animals}
          species={species}
          onSuccess={refresh}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <SheepObservationsTimeline refreshKey={refreshKey} />
    </>
  );
}
