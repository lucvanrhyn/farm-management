"use client";

import { useState, useEffect, useCallback } from "react";
import { parseDetails } from "@/components/admin/observations-log/parseDetails";
import { TYPE_BADGE, TYPE_LABEL } from "@/components/admin/observations-log/constants";
import { clientLogger } from "@/lib/client-logger";

interface ObservationRow {
  id: string;
  type: string;
  campId: string;
  animalId: string | null;
  details: string;
  observedAt: string;
  loggedBy: string | null;
  // Issue #492 — first-class free-text note (Path A); surfaced below the
  // structured summary.
  notes: string | null;
}

interface Props {
  /**
   * Issue #496 — refresh signal. The page bumps this on `router.refresh()`
   * (after a "+ New Entry" create) so the client timeline re-fetches the
   * freshly-written row. Absent on the first render.
   */
  refreshKey?: number;
}

const PAGE_SIZE = 50;

/**
 * Sheep observations timeline (#496).
 *
 * Migrated off the SSR facade (`scoped(prisma, "sheep").observation.findMany`)
 * onto the now species-aware `/api/observations?species=sheep` endpoint that
 * #491 introduced. The route IS the species axis (ADR-0003), so the param is
 * the literal "sheep" regardless of the farm-mode cookie — a user who
 * deep-links here while their cookie reads "cattle" still gets sheep rows.
 *
 * The `?species=sheep` narrowing relies on the OPT-IN behaviour #491 added to
 * `listObservations`: the `species` predicate is applied only when the param
 * is present, so this feed shows sheep-only rows while the species-blind
 * cattle/admin timeline default stays a cross-species rollup.
 */
export default function SheepObservationsTimeline({ refreshKey = 0 }: Props) {
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch lives in a callback (not the effect body) so the React-Compiler
  // set-state-in-effect rule is satisfied — same shape as the cattle
  // `ObservationsLog`. The effect just invokes it and wires AbortController.
  const fetchObs = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("species", "sheep");
    params.set("limit", String(PAGE_SIZE));
    try {
      const res = await fetch(`/api/observations?${params.toString()}`, { signal });
      if (!res.ok) {
        setObservations([]);
        return;
      }
      const data: ObservationRow[] = await res.json();
      setObservations(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== "AbortError") {
        clientLogger.error("[SheepObservationsTimeline] Failed to load observations", { err });
        setObservations([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-runs on mount and whenever `refreshKey` is bumped (after a create), so
  // a newly-logged sheep observation is fetched and painted.
  useEffect(() => {
    const controller = new AbortController();
    fetchObs(controller.signal);
    return () => controller.abort();
  }, [refreshKey, fetchObs]);

  if (loading) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{ background: "#FFFFFF", border: "1px solid #E8DFD2" }}
      >
        <p className="text-sm" style={{ color: "#9C8E7A" }}>
          Loading sheep observations…
        </p>
      </div>
    );
  }

  if (observations.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{ background: "#FFFFFF", border: "1px solid #E8DFD2" }}
      >
        <p className="text-sm" style={{ color: "#9C8E7A" }}>
          No sheep observations yet. Use <span className="font-semibold">+ New Entry</span> above to log the first one.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-2" data-testid="sheep-observations-timeline">
      {observations.map((o) => {
        const badge = TYPE_BADGE[o.type] ?? { color: "#9C8E7A", bg: "rgba(156,142,122,0.12)" };
        const label = TYPE_LABEL[o.type] ?? o.type;
        const summary = parseDetails(o.details, o.type);
        const observedAt = new Date(o.observedAt);
        return (
          <li
            key={o.id}
            data-testid="sheep-observation-row"
            className="rounded-xl p-4 flex flex-col gap-2"
            style={{ background: "#FFFFFF", border: "1px solid #E8DFD2" }}
          >
            <div className="flex items-center gap-2 text-xs">
              <span
                className="px-2 py-0.5 rounded-md font-semibold"
                style={{ color: badge.color, background: badge.bg }}
              >
                {label}
              </span>
              <span style={{ color: "#9C8E7A" }}>{observedAt.toLocaleString()}</span>
              {o.loggedBy ? (
                <span style={{ color: "#9C8E7A" }}>· {o.loggedBy}</span>
              ) : null}
            </div>
            <div className="text-sm" style={{ color: "#1C1815" }}>
              {summary || <span style={{ color: "#9C8E7A" }}>(no details)</span>}
            </div>
            {/* Issue #492 — free-text note, unobtrusive italic line below the
                structured summary. */}
            {o.notes ? (
              <div
                className="text-sm italic"
                data-testid="sheep-observation-note"
                style={{ color: "#6B5C4E" }}
              >
                “{o.notes}”
              </div>
            ) : null}
            <div className="text-xs" style={{ color: "#9C8E7A" }}>
              Camp {o.campId}
              {o.animalId ? ` · Animal ${o.animalId}` : ""}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
