import type { CampRotationStatus } from "@/lib/server/rotation-engine";
import type { RotationStatus } from "@/lib/calculators/rotation";

interface MovementRow {
  readonly id: string;
  readonly observedAt: Date;
  readonly details: string;
  readonly loggedBy: string | null;
}

interface MovementDetails {
  mobId?: string;
  mobName?: string;
  sourceCamp?: string;
  destCamp?: string;
  animalCount?: number;
}

const STATUS_META: Record<RotationStatus, { color: string; label: string }> = {
  grazing: { color: "#3b82f6", label: "Grazing" },
  overstayed: { color: "#dc2626", label: "Overstayed" },
  resting_ready: { color: "#16a34a", label: "Ready to Graze" },
  resting: { color: "#86efac", label: "Resting" },
  overdue_rest: { color: "#f59e0b", label: "Overdue Rest" },
  unknown: { color: "#9ca3af", label: "Unknown" },
};

function formatDate(iso: Date | string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function CampRotationHistoryPanel({
  campId,
  status,
  movements,
}: {
  campId: string;
  status: CampRotationStatus | null;
  movements: ReadonlyArray<MovementRow>;
}) {
  const meta = status ? STATUS_META[status.status] : STATUS_META.unknown;

  return (
    <div
      className="rounded-2xl border p-6 mb-6"
      style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
    >
      <h2 className="text-sm font-semibold mb-4" style={{ color: "#1C1815" }}>
        Rotation History
      </h2>

      {/* Current status strip */}
      {status && (
        <div className="flex flex-wrap items-center gap-4 mb-5 pb-4" style={{ borderBottom: "1px solid #F0E8DE" }}>
          <span
            className="inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full"
            style={{ background: `${meta.color}22`, color: meta.color }}
          >
            <span
              className="inline-block rounded-full"
              style={{ width: 8, height: 8, background: meta.color }}
            />
            {meta.label}
          </span>
          {status.daysGrazed !== null && (
            <span className="text-xs" style={{ color: "#6B5C4E" }}>
              <span className="font-mono font-semibold">{status.daysGrazed}d</span> grazed (max{" "}
              <span className="font-mono">{status.effectiveMaxGrazingDays}d</span>)
            </span>
          )}
          {status.daysRested !== null && (
            <span className="text-xs" style={{ color: "#6B5C4E" }}>
              <span className="font-mono font-semibold">{status.daysRested}d</span> rested (target{" "}
              <span className="font-mono">{status.effectiveRestDays}d</span>)
            </span>
          )}
          {status.nextEligibleDate && (
            <span className="text-xs" style={{ color: "#9C8E7A" }}>
              Eligible from <span className="font-mono">{formatDate(status.nextEligibleDate)}</span>
            </span>
          )}
        </div>
      )}

      {/* Movement list */}
      {movements.length === 0 ? (
        <p className="text-sm" style={{ color: "#9C8E7A" }}>
          No mob movements recorded for this camp.
        </p>
      ) : (
        <ol className="space-y-2">
          {movements.map((m) => {
            let details: MovementDetails = {};
            try {
              details = JSON.parse(m.details) as MovementDetails;
            } catch {
              // malformed — skip detail rendering but still show the row
            }
            const isArrival = details.destCamp === campId;
            const isDeparture = details.sourceCamp === campId;
            const arrow = isArrival ? "←" : isDeparture ? "→" : "·";
            const arrowColor = isArrival ? "#16a34a" : isDeparture ? "#8B6914" : "#9C8E7A";
            const otherCamp = isArrival ? details.sourceCamp : details.destCamp;

            return (
              <li
                key={m.id}
                className="flex items-center gap-3 text-sm py-1.5"
                style={{ borderBottom: "1px solid #F0E8DE" }}
              >
                <span
                  className="font-mono text-base shrink-0"
                  style={{ color: arrowColor, width: 16, textAlign: "center" }}
                  aria-label={isArrival ? "Arrived" : isDeparture ? "Departed" : "Movement"}
                >
                  {arrow}
                </span>
                <span className="font-mono text-xs shrink-0" style={{ color: "#9C8E7A", width: 80 }}>
                  {formatDate(m.observedAt)}
                </span>
                <span className="flex-1 min-w-0 truncate" style={{ color: "#1C1815" }}>
                  {details.mobName ?? "Unknown mob"}
                  {typeof details.animalCount === "number" && (
                    <span style={{ color: "#9C8E7A" }}> · {details.animalCount} animals</span>
                  )}
                  {otherCamp && (
                    <span style={{ color: "#9C8E7A" }}>
                      {" "}
                      · {isArrival ? "from" : "to"} <span className="font-mono">{otherCamp}</span>
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
