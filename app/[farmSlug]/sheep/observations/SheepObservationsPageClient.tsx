"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import CreateObservationModal from "@/components/admin/CreateObservationModal";

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
 * Sheep observations page client — owns the "+ New Entry" button and the
 * create-observation modal. The visible timeline is server-rendered by
 * `SheepObservationsTimeline` (sibling), so this component is intentionally
 * narrower than the cattle `ObservationsPageClient` — see page.tsx header
 * for the rationale (the `/api/observations` endpoint is species-blind
 * today; SSR-rendering the timeline keeps the species axis structurally
 * enforced for this slice).
 */
export default function SheepObservationsPageClient({ camps, animals, species }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const router = useRouter();

  // On successful create, refresh the server component so the SSR
  // timeline picks up the new row. Mirrors how /sheep/animals refreshes
  // after a record-birth event.
  const refresh = useCallback(() => {
    setShowCreate(false);
    router.refresh();
  }, [router]);

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
          species={species}
          onSuccess={refresh}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </>
  );
}
