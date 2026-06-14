"use client";

import { useState, useCallback } from "react";
import ObservationsLog from "@/components/admin/ObservationsLog";
import CreateObservationModal from "@/components/admin/CreateObservationModal";

interface Props {
  camps: { id: string; name: string }[];
  animals: { id: string; tag: string; campId: string }[];
  /**
   * Active farm-mode species (SSR-resolved via `getFarmMode` in the page
   * server component). Forwarded to the create-observation modal so its
   * server-side animal picker filters to the right species, AND to
   * `ObservationsLog` (#496) so the timeline requests the species-aware
   * `/api/observations?species=<active>` on a multi-species tenant.
   */
  species?: string | null;
}

export default function ObservationsPageClient({ camps, animals, species }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setShowCreate(false);
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

      <ObservationsLog key={refreshKey} species={species} />
    </>
  );
}
