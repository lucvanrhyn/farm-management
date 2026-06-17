"use client";

/**
 * components/admin/DoNextPanel.tsx — Proactive Nudges v1 "Do Next" panel
 * (decision 10a).
 *
 * The dashboard surface for the ranked DoNextItem[] feed (lib/server/nudges/feed.ts).
 * Each nudge is a Card carrying:
 *   - the deterministic "why now" narration (narrateNudge — offline, no LLM),
 *   - a PRIMARY one-tap action: a link to the prefilled form via
 *     scopeHref(item.href, farmSlug) (decision 7: accept = client navigation,
 *     no server write),
 *   - a DISMISS control → PATCH /api/notifications/[id] (marks the row read),
 *   - an "add as task" (do-later) control → POST /api/tasks with the
 *     buildNudgeTaskInput body (online-only — no `task` SyncKind). When
 *     task-dedup already flags the action as scheduled (scheduledIds), the
 *     add-task control is replaced by an "Already scheduled" marker.
 *
 * Upgrade-gated actions (IT3 on a non-advanced farm) render the upgrade label as
 * the primary link and omit the add-task control (nothing to schedule).
 *
 * Token-driven: components/ds + --ft-* tokens only (no bespoke styling). New
 * client component (no exports added to the heavily-mocked hot modules).
 */

import { useState } from "react";
import Link from "next/link";
import { Card, Button, Icon } from "@/components/ds";
import { scopeHref } from "@/lib/notifications/scope-href";
import type { DoNextItem } from "@/lib/server/nudges/feed";
import { narrateNudge } from "@/lib/server/nudges/narrate";
import { buildNudgeTaskInput } from "@/lib/server/nudges/do-later";

interface Props {
  items: DoNextItem[];
  farmSlug: string;
  /**
   * Notification ids whose action task-dedup already flagged as scheduled
   * (server-computed via isActionAlreadyScheduled). The feed shows an "Already
   * scheduled" marker instead of the add-task button for these.
   */
  scheduledIds?: string[];
  /** Actor email for the do-later task assignee/audit trail. */
  createdBy?: string;
}

function NudgeCard({
  item,
  farmSlug,
  scheduled,
  createdBy,
  onDismiss,
}: {
  item: DoNextItem;
  farmSlug: string;
  scheduled: boolean;
  createdBy: string;
  onDismiss: (id: string) => void;
}) {
  // "addState" tracks the do-later button: idle → busy → done. `scheduled`
  // (server task-dedup) short-circuits to the "already scheduled" marker.
  const [addState, setAddState] = useState<"idle" | "busy" | "done">("idle");

  const accent = item.severity === "red" ? "var(--ft-poor)" : "var(--ft-fair)";
  const href = scopeHref(item.href, farmSlug);
  const gated = item.action.upgradeGated === true;
  // A do-later task needs a per-entity target (camp / animal / water point).
  // Upgrade-gated and farm-wide (IT3) actions have nothing to schedule.
  const canSchedule =
    !gated &&
    (!!item.action.target.campId ||
      !!item.action.target.animalId ||
      !!item.action.target.waterPointId);

  async function addAsTask() {
    if (addState !== "idle") return;
    setAddState("busy");
    try {
      const body = buildNudgeTaskInput(item.action, item.type, { createdBy });
      const res = await fetch("/api/tasks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setAddState(res.ok ? "done" : "idle");
    } catch {
      setAddState("idle");
    }
  }

  return (
    <Card
      className="flex flex-col gap-2.5"
      style={{ padding: "var(--ft-card-pad)", borderLeft: `3px solid ${accent}` }}
    >
      {/* Why now — deterministic offline narration */}
      <p className="text-sm leading-snug" style={{ color: "var(--ft-text)" }}>
        {narrateNudge(item)}
      </p>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Primary one-tap action — client navigation to the prefilled form. */}
        <Link
          href={href}
          className="ft-btn ft-btn-primary"
          style={{ fontSize: 12, padding: "7px 12px" }}
        >
          {item.action.label}
        </Link>

        {scheduled ? (
          <span
            className="ft-pill ft-pill-good"
            style={{ fontSize: 11.5 }}
            data-testid="nudge-already-scheduled"
          >
            <Icon.check size={13} /> Already scheduled
          </span>
        ) : canSchedule ? (
          <Button
            variant="ghost"
            onClick={() => void addAsTask()}
            disabled={addState !== "idle"}
            style={{ fontSize: 12, padding: "7px 12px" }}
            icon={<Icon.plus size={13} />}
          >
            {addState === "done" ? "Added" : "Add as task"}
          </Button>
        ) : null}

        {/* Dismiss — marks the notification read. */}
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          className="ml-auto shrink-0 p-1 rounded transition-opacity hover:opacity-70"
          style={{ color: "var(--ft-subtle)" }}
          aria-label="Dismiss nudge"
          title="Dismiss"
        >
          <Icon.close size={14} />
        </button>
      </div>
    </Card>
  );
}

export default function DoNextPanel({
  items,
  farmSlug,
  scheduledIds,
  createdBy = "",
}: Props) {
  // Dismissed ids are tracked locally so a dismiss optimistically removes the
  // card without a refetch (the PATCH invalidates the cache on the next load).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const scheduled = new Set(scheduledIds ?? []);
  const visible = items.filter((it) => !dismissed.has(it.id));

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    void fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      credentials: "include",
    }).catch(() => undefined);
  }

  if (visible.length === 0) return null;

  return (
    <div
      data-testid="do-next-panel"
      className="rounded-xl p-4 mb-6"
      style={{
        background: "var(--ft-surface)",
        border: "1px solid var(--ft-border)",
        borderLeft: "4px solid var(--ft-accent)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon.einstein size={15} style={{ color: "var(--ft-accent)" }} />
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--ft-accent)" }}
        >
          Do Next
        </span>
        <span
          className="text-xs font-semibold font-mono px-2 py-0.5 rounded-full"
          style={{ background: "var(--ft-accent-faint)", color: "var(--ft-accent)" }}
        >
          {visible.length}
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {visible.map((it) => (
          <NudgeCard
            key={it.id}
            item={it}
            farmSlug={farmSlug}
            scheduled={scheduled.has(it.id)}
            createdBy={createdBy}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </div>
  );
}
