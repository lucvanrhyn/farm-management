"use client";

/**
 * components/admin/TriageClient.tsx — Herd Triage v1 surface (decision 10b).
 *
 * The group-by-ANIMAL counterpart to AlertsFilterClient's group-by-reason
 * view. Consumes the pre-ranked AttentionItem[] read model (the orchestrator
 * already sorts urgency DESC → reason-count DESC → animalId ASC) and adds:
 *   - herd-at-a-glance KpiCards (total needing attention / urgent),
 *   - a Segmented severity filter + a reason <select> filter,
 *   - a ranked list, each row a tap-through to the animal (keyed on the
 *     business key animalId, NOT the cuid),
 *   - an "unlock more" strip for history-reason categories not yet present.
 *
 * Detection + ranking are headless/offline; this component is pure
 * presentation over the projected items. Narration uses the deterministic
 * offline narrator (narrate.ts) — no online call in the list itself.
 *
 * Triage is NOT tier-gated — it is the trial-acquisition aha surface (the page
 * renders it for every tier).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, KpiCard, Pill, Segmented, Icon } from "@/components/ds";
import type { AttentionItem, Reason } from "@/lib/server/triage/types";
import { narrateTriageItem } from "@/lib/server/triage/narrate";
import { reasonLabel, HISTORY_REASON_IDS } from "@/lib/server/triage/labels";
import type { ReasonId } from "@/lib/server/triage/reasons";

type SeverityFilter = "all" | "red" | "amber";

const SEVERITY_OPTIONS: { value: SeverityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "red", label: "Critical" },
  { value: "amber", label: "Caution" },
];

interface Props {
  items: AttentionItem[];
  farmSlug: string;
}

function ReasonBadge({ reason }: { reason: Reason }) {
  return (
    <Pill tone={reason.severity === "red" ? "crit" : "fair"}>
      {reasonLabel(reason.id as ReasonId)}
    </Pill>
  );
}

function TriageRow({ item, farmSlug }: { item: AttentionItem; farmSlug: string }) {
  const accent = item.severity === "red" ? "var(--ft-crit)" : "var(--ft-fair)";
  return (
    <Link
      href={`/${farmSlug}/admin/animals/${item.animalId}`}
      className="ft-card ft-card-lift block"
      style={{
        padding: "var(--ft-card-pad)",
        borderLeft: `3px solid ${accent}`,
        textDecoration: "none",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="ft-mono"
          style={{ fontSize: 15, fontWeight: 600, color: "var(--ft-text)" }}
        >
          {item.animalId}
        </span>
        <span className="flex flex-wrap justify-end gap-1.5">
          {item.reasons.map((r) => (
            <ReasonBadge key={r.id} reason={r} />
          ))}
        </span>
      </div>
      <p className="mt-2" style={{ fontSize: 13, color: "var(--ft-muted)" }}>
        {narrateTriageItem(item)}
      </p>
    </Link>
  );
}

function UnlockStrip({ items }: { items: AttentionItem[] }) {
  // History reasons not yet present anywhere in the data read as greyed,
  // upsell "unlock more" categories. Snapshot reasons are always live so they
  // never appear here.
  const present = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) for (const r of it.reasons) s.add(r.id);
    return s;
  }, [items]);

  const locked = HISTORY_REASON_IDS.filter((id) => !present.has(id));
  if (locked.length === 0) return null;

  return (
    <div
      data-testid="triage-unlock-strip"
      className="ft-card"
      style={{ padding: "var(--ft-card-pad)" }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <Icon.layers size={15} style={{ color: "var(--ft-subtle)" }} />
        <span
          className="ft-mono"
          style={{ fontSize: 11.5, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ft-subtle)" }}
        >
          Unlock more
        </span>
      </div>
      <p className="mb-3" style={{ fontSize: 12.5, color: "var(--ft-muted)" }}>
        Keep logging to surface these per-animal flags automatically.
      </p>
      <div className="flex flex-wrap gap-2">
        {locked.map((id) => (
          <span
            key={id}
            className="ft-pill"
            style={{
              opacity: 0.55,
              borderStyle: "dashed",
              color: "var(--ft-subtle)",
              background: "transparent",
            }}
          >
            {reasonLabel(id)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function TriageClient({ items, farmSlug }: Props) {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [reasonFilter, setReasonFilter] = useState<"all" | ReasonId>("all");

  const urgentCount = useMemo(
    () => items.filter((i) => i.severity === "red").length,
    [items],
  );

  // Reason options for the <select> — only reasons actually present in the
  // data, in registry order (stable).
  const reasonOptions = useMemo(() => {
    const present = new Set<ReasonId>();
    for (const it of items) for (const r of it.reasons) present.add(r.id as ReasonId);
    return [...present];
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (severity !== "all" && i.severity !== severity) return false;
      if (reasonFilter !== "all" && !i.reasons.some((r) => r.id === reasonFilter)) {
        return false;
      }
      return true;
    });
  }, [items, severity, reasonFilter]);

  if (items.length === 0) {
    return (
      <Card style={{ padding: "var(--ft-card-pad)" }}>
        <div className="flex items-center gap-3">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: "var(--ft-good)" }}
          />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--ft-good)" }}>
              All clear
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--ft-muted)" }}>
              No animals need attention right now.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Herd at a glance */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
      >
        <div data-testid="triage-kpi-total">
          <KpiCard
            icon={<Icon.animals size={17} />}
            label="Need attention"
            value={items.length}
          />
        </div>
        <div data-testid="triage-kpi-urgent">
          <KpiCard
            icon={<Icon.alerts size={17} />}
            label="Urgent"
            value={urgentCount}
            accentValue={urgentCount > 0 ? "poor" : "good"}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <Segmented
          aria-label="Filter by severity"
          value={severity}
          onChange={setSeverity}
          options={SEVERITY_OPTIONS}
        />
        <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: "var(--ft-subtle)" }}>
          <span className="ft-mono" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>
            Reason
          </span>
          <select
            aria-label="Filter by reason"
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value as "all" | ReasonId)}
            className="ft-mono"
            style={{
              fontSize: 12.5,
              padding: "5px 9px",
              borderRadius: "var(--ft-r-sm)",
              border: "1px solid var(--ft-border)",
              background: "var(--ft-surface)",
              color: "var(--ft-text)",
            }}
          >
            <option value="all">All reasons</option>
            {reasonOptions.map((id) => (
              <option key={id} value={id}>
                {reasonLabel(id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Ranked list */}
      {filtered.length === 0 ? (
        <Card style={{ padding: "var(--ft-card-pad)" }}>
          <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>
            No animals match the selected filters.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((it) => (
            <TriageRow key={it.animalId} item={it} farmSlug={farmSlug} />
          ))}
        </div>
      )}

      {/* Unlock more — greyed history categories not yet present */}
      <UnlockStrip items={items} />

      {/* Cross-link to the aggregate alert centre */}
      <Link
        href={`/${farmSlug}/admin/alerts`}
        className="ft-mono"
        style={{ fontSize: 12.5, color: "var(--ft-subtle)", textDecoration: "none" }}
      >
        View the alert centre →
      </Link>
    </div>
  );
}
