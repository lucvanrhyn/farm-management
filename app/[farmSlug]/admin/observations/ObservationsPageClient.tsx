"use client";

import { useState, useCallback } from "react";
import ObservationsLog from "@/components/admin/ObservationsLog";
import CreateObservationModal from "@/components/admin/CreateObservationModal";

interface Props {
  camps: { id: string; name: string }[];
  animals: { id: string; tag: string; campId: string }[];
}

export default function ObservationsPageClient({ camps, animals }: Props) {
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
          style={{ background: "#4A7C59", color: "#F5EBD4" }}
        >
          + New Entry
        </button>
      </div>

      {showCreate && (
        <CreateObservationModal
          camps={camps}
          animals={animals}
          onSuccess={refresh}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <ObservationsLog key={refreshKey} />
    </>
  );
}
