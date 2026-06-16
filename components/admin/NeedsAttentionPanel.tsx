// components/admin/NeedsAttentionPanel.tsx
import Link from "next/link";
import { Card, Pill, StatusDot, Label, Icon } from "@/components/ds";
import type { Status } from "@/components/ds";
import type { DashboardAlerts, DashboardAlert } from "@/lib/server/dashboard-alerts";
import type { AttentionItem } from "@/lib/server/triage/types";
import { narrateHerdGlance } from "@/lib/server/triage/narrate";
import { reasonLabel } from "@/lib/server/triage/labels";
import type { ReasonId } from "@/lib/server/triage/reasons";

interface Props {
  alerts: DashboardAlerts;
  farmSlug: string;
  /**
   * Per-animal Herd Triage read model (decision 10a). OPTIONAL + additive: the
   * panel renders its existing aggregate-alert rows unchanged when omitted, and
   * surfaces a per-animal top-5 teaser + herd-glance one-liner + deep-link to
   * the full /admin/triage page when supplied.
   */
  triage?: AttentionItem[];
}

/** How many animals the dashboard teaser shows before deferring to the page. */
const TRIAGE_TEASER_LIMIT = 5;

function AlertRow({ alert }: { alert: DashboardAlert }) {
  // Map the alert severity onto the shared status palette: red → poor (warm
  // rust), amber → fair (ochre). StatusDot / Pill then pull the tokenised
  // colour so the row never hand-rolls off-palette rgba values.
  const status: Status = alert.severity === "red" ? "poor" : "fair";

  return (
    <Link
      href={alert.href}
      className="ft-row-hover flex items-center gap-3 px-3 py-2.5"
      style={{ borderRadius: "var(--ft-r-sm)" }}
    >
      <StatusDot status={status} size={8} />

      {/* Message */}
      <span className="flex-1 text-sm" style={{ color: "var(--ft-text)" }}>
        {alert.message}
      </span>

      {/* Count badge — tokenised pill */}
      <Pill tone={status} className="shrink-0">
        {alert.count}
      </Pill>

      {/* Chevron to detail */}
      <span className="shrink-0" style={{ color: "var(--ft-subtle)" }}>
        <Icon.chevron size={15} />
      </span>
    </Link>
  );
}

/**
 * Per-animal Triage teaser — the "which animal first?" dashboard slice. Shows
 * a herd-glance one-liner + the top-N ranked animals (the orchestrator already
 * sorts them) + a deep-link to the full triage page.
 */
function TriageTeaser({
  triage,
  farmSlug,
}: {
  triage: AttentionItem[];
  farmSlug: string;
}) {
  const top = triage.slice(0, TRIAGE_TEASER_LIMIT);
  const overflow = triage.length - top.length;

  return (
    <div
      data-testid="needs-attention-triage"
      className="rounded-xl p-4 mb-6"
      style={{
        background: "var(--ft-surface)",
        border: "1px solid var(--ft-border)",
        borderLeft: `4px solid var(--ft-fair)`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--ft-fair)" }}
        >
          Triage
        </span>
        <Link
          href={`/${farmSlug}/admin/triage`}
          className="text-xs font-mono transition-opacity hover:opacity-70"
          style={{ color: "var(--ft-subtle)" }}
        >
          View triage →
        </Link>
      </div>

      {/* Einstein / offline one-liner (deterministic narration) */}
      <p className="text-sm mb-3" style={{ color: "var(--ft-muted)" }}>
        {narrateHerdGlance(triage)}
      </p>

      {/* Top-N per-animal rows */}
      <div className="flex flex-col gap-1.5">
        {top.map((it) => {
          const isRed = it.severity === "red";
          const accent = isRed ? "var(--ft-poor)" : "var(--ft-fair)";
          return (
            <Link
              key={it.animalId}
              href={`/${farmSlug}/admin/animals/${it.animalId}`}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-opacity hover:opacity-80"
              style={{
                background: isRed ? "rgba(192,87,76,0.06)" : "var(--ft-surface2)",
                border: "1px solid var(--ft-border)",
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
              <span
                className="text-sm font-mono font-semibold shrink-0"
                style={{ color: "var(--ft-text)" }}
              >
                {it.animalId}
              </span>
              <span className="flex-1 truncate text-xs" style={{ color: "var(--ft-subtle)" }}>
                {it.reasons.map((r) => reasonLabel(r.id as ReasonId)).join(" · ")}
              </span>
            </Link>
          );
        })}
      </div>

      {overflow > 0 && (
        <Link
          href={`/${farmSlug}/admin/triage`}
          className="block mt-2 text-xs font-mono transition-opacity hover:opacity-70"
          style={{ color: "var(--ft-subtle)" }}
        >
          +{overflow} more →
        </Link>
      )}
    </div>
  );
}

export default function NeedsAttentionPanel({ alerts, farmSlug, triage }: Props) {
  const hasTriage = !!triage && triage.length > 0;
  const triageTeaser = hasTriage ? (
    <TriageTeaser triage={triage} farmSlug={farmSlug} />
  ) : null;

  if (alerts.totalCount === 0) {
    return (
      <>
        {triageTeaser}
        <Card
          className="flex items-center gap-3"
          style={{ padding: "16px 20px" }}
        >
          <StatusDot status="good" size={8} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--ft-good)" }}>All clear</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--ft-muted)" }}>No immediate actions required.</p>
          </div>
        </Card>
      </>
    );
  }

  const headStatus: Status = alerts.red.length > 0 ? "poor" : "fair";

  return (
    <>
      {triageTeaser}
      <Card style={{ padding: "var(--ft-card-pad)" }}>
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-3">
          <span style={{ color: `var(--ft-${headStatus})` }}>
            <Icon.alerts size={16} />
          </span>
          <Label style={{ color: `var(--ft-${headStatus})` }}>Needs Attention</Label>
          <Pill tone={headStatus} className="ml-auto">
            {alerts.totalCount} {alerts.totalCount === 1 ? "item" : "items"}
          </Pill>
        </div>

        {/* Red alerts section */}
        {alerts.red.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-1.5">
            {alerts.red.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        )}

        {/* Amber alerts section */}
        {alerts.amber.length > 0 && (
          <>
            {alerts.red.length > 0 && (
              <div className="my-1.5" style={{ borderTop: "1px dashed var(--ft-border2)" }} />
            )}
            <div className="flex flex-col gap-1.5">
              {alerts.amber.map((alert) => (
                <AlertRow key={alert.id} alert={alert} />
              ))}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
