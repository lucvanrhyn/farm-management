/**
 * components/admin/ThisWeekBriefing.tsx — Weekly Farm Briefing v1, decision 8:
 * the in-app "This week" dashboard card.
 *
 * Renders the DETERMINISTIC BriefingPayload (lib/server/briefing/payload.ts)
 * live on each dashboard load. The card is ALWAYS visible. Graceful degradation
 * is LOAD-BEARING: each of the three farmer-facing sections — what changed /
 * what to watch / what to do — renders ONLY when its payload array is non-empty,
 * and when every section is empty the card shows a steady "quiet week" state.
 *
 * No LLM on the dashboard hot path: this card uses ONLY the deterministic
 * payload (narration is reserved for the weekly EMAIL, narrator.ts). It mounts
 * fail-open in DashboardContent (try/catch → render nothing) so a tenant-DB blip
 * never takes the dashboard down — mirroring the triage teaser / DoNextPanel.
 *
 * Token-driven: components/ds + --ft-* tokens only. Mirrors the Einstein
 * "TODAY'S BRIEF" card surface already in DashboardContent.
 */

import Link from "next/link";
import { Card, Icon, StatusDot, Label } from "@/components/ds";
import type { BriefingPayload } from "@/lib/server/briefing/payload";
import type { Status } from "@/components/ds";

interface Props {
  /** The deterministic briefing read model (the source of truth — no LLM). */
  payload: BriefingPayload;
  /** Active farm slug — for the section deep-links. */
  farmSlug: string;
}

/** A briefing section: an eyebrow header + its deterministic lines. The dot
 *  status colour-codes the section the same way the Einstein brief does. */
function BriefingSection({
  title,
  status,
  lines,
}: {
  title: string;
  status: Status;
  lines: string[];
}) {
  if (lines.length === 0) return null;
  const dot = {
    good: "var(--ft-good)",
    fair: "var(--ft-fair)",
    poor: "var(--ft-poor)",
    critical: "var(--ft-crit)",
  }[status];
  return (
    <div className="flex flex-col gap-2">
      <Label className="block" style={{ color: "var(--ft-muted)" }}>
        {title}
      </Label>
      <div className="flex flex-col gap-2">
        {lines.map((line, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5"
            style={{ fontSize: 13.5, color: "var(--ft-muted)", lineHeight: 1.5 }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                marginTop: 5,
                flexShrink: 0,
                background: dot,
              }}
            />
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ThisWeekBriefing({ payload, farmSlug }: Props) {
  return (
    <Card data-testid="this-week-briefing" style={{ padding: 0, overflow: "hidden" }}>
      {/* Eyebrow header — always visible, mirrors the Einstein brief header. */}
      <div
        className="flex items-center gap-2.5"
        style={{ padding: "14px 18px 11px", color: "var(--ft-accent)" }}
      >
        <Icon.history size={16} />
        <span
          className="ft-mono"
          style={{ fontSize: 10.5, letterSpacing: ".16em", fontWeight: 600 }}
        >
          THIS WEEK
        </span>
        <span className="flex-1" />
        <StatusDot status={payload.isEmpty ? "good" : "fair"} />
      </div>

      <div style={{ padding: "0 18px 16px" }} className="flex flex-col gap-4">
        {payload.isEmpty ? (
          <p style={{ fontSize: 13.5, color: "var(--ft-muted)", lineHeight: 1.5 }}>
            A quiet week — nothing notable moved on the farm. Keep logging
            weigh-ins and inspections to sharpen next week&apos;s briefing.
          </p>
        ) : (
          <>
            <BriefingSection
              title="What changed"
              status="good"
              lines={payload.whatChanged}
            />
            <BriefingSection
              title="What to watch"
              status="fair"
              lines={payload.whatToWatch}
            />
            <BriefingSection
              title="What to do"
              status="poor"
              lines={payload.whatToDo}
            />
          </>
        )}

        <Link
          href={`/${farmSlug}/admin/einstein`}
          className="text-xs font-medium text-right block transition-opacity hover:opacity-70 ft-mono"
          style={{ color: "var(--ft-accent)" }}
        >
          Ask for more &rarr;
        </Link>
      </div>
    </Card>
  );
}
