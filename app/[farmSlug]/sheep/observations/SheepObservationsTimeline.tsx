import { parseDetails } from "@/components/admin/observations-log/parseDetails";
import { TYPE_BADGE, TYPE_LABEL } from "@/components/admin/observations-log/constants";

interface ObservationRow {
  id: string;
  type: string;
  campId: string;
  animalId: string | null;
  details: string;
  observedAt: string;
  loggedBy: string | null;
}

interface Props {
  observations: ObservationRow[];
}

/**
 * Server-rendered observations timeline for the sheep namespace.
 *
 * Pure presentational component — receives a pre-filtered observation
 * list (sheep-only, species axis enforced by the page-level
 * `scoped(prisma, "sheep")` query). Reuses `parseDetails` and the
 * type-badge styles from the cattle timeline so the visual language is
 * consistent across species.
 *
 * Editing / pagination intentionally omitted from this tracer-bullet
 * slice — they require the API layer to grow a species filter
 * (`/api/observations?species=sheep`) which is a follow-up wave. The
 * "+ New Entry" path on this page does work (it's a write to the same
 * species-aware `createObservation` domain op that the cattle page uses,
 * plus a `router.refresh()` to repaint the SSR timeline).
 */
export default function SheepObservationsTimeline({ observations }: Props) {
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
