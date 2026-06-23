"use client";

import { useState } from "react";
import { useClientTime } from "@/lib/hooks/use-client-time";
import type { BreedingSnapshot, InbreedingRisk, PairingSuggestion } from "@/lib/server/breeding-analytics";
import type { BreedingAIResponse } from "@/app/api/[farmSlug]/breeding/analyze/route";

interface BreedingDashboardProps {
  snapshot: BreedingSnapshot;
  pairings: PairingSuggestion[];
  inbreedingRisks: InbreedingRisk[];
  farmSlug: string;
}

const STATUS_COLORS = {
  good:    { bar: "var(--ft-good)", text: "var(--ft-good)", bg: "rgba(74,124,89,0.10)" },
  warning: { bar: "var(--ft-fair)", text: "var(--ft-fair)", bg: "rgba(139,105,20,0.10)" },
  alert:   { bar: "var(--ft-poor)", text: "var(--ft-poor)", bg: "rgba(192,87,76,0.10)" },
  neutral: { bar: "var(--ft-subtle)", text: "var(--ft-subtle)", bg: "rgba(156,142,122,0.10)" },
};

/**
 * Mount-gated countdown badge for an upcoming calving (React #418).
 *
 * The relative day count derives from the wall clock: the server reads it at
 * render time (UTC) and the client at hydration (browser zone), so across a
 * calendar-day rollover the two disagree → #418. `useClientTime` returns the
 * stable `null` placeholder on the first (server-equivalent) render and only
 * computes the live countdown after the client mounts, so the server render and
 * the client's first render always agree byte-for-byte. (Reading the clock via
 * the hook also keeps the impure `new Date()` out of the render body, which the
 * React-Compiler lint rule forbids.)
 */
export function CalvingCountdownBadge({ expectedDate }: { expectedDate: string }) {
  const daysAway = useClientTime<number | null>(
    (now) => Math.round((new Date(expectedDate).getTime() - now.getTime()) / 86_400_000),
    null,
  );
  const className = "text-xs px-2 py-0.5 rounded-md font-medium";
  if (daysAway === null) {
    const c = STATUS_COLORS.neutral;
    return <span className={className} style={{ background: c.bg, color: c.text }}>…</span>;
  }
  const urgency = daysAway < 0 ? "alert" : daysAway <= 14 ? "warning" : "neutral";
  const c = STATUS_COLORS[urgency];
  return (
    <span className={className} style={{ background: c.bg, color: c.text }}>
      {daysAway < 0 ? `${Math.abs(daysAway)}d overdue` : daysAway === 0 ? "Today" : `${daysAway}d away`}
    </span>
  );
}

function getScoreColor(score: number): { bg: string; text: string; border: string } {
  if (score > 70) return { bg: "rgba(74,124,89,0.12)", text: "var(--ft-good)", border: "rgba(74,124,89,0.3)" };
  if (score >= 40) return { bg: "rgba(139,105,20,0.12)", text: "var(--ft-fair)", border: "rgba(139,105,20,0.3)" };
  return { bg: "rgba(192,87,76,0.12)", text: "var(--ft-poor)", border: "rgba(192,87,76,0.3)" };
}

function ScoreBadge({ score }: { score: number }) {
  const colors = getScoreColor(score);
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold tabular-nums"
      style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
    >
      {score}
    </span>
  );
}

function CoiBadge({ coi }: { coi: number }) {
  const pct = (coi * 100).toFixed(1);
  const isHigh = coi > 0.03125;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium tabular-nums"
      style={{
        background: isHigh ? "rgba(192,87,76,0.08)" : "rgba(156,142,122,0.08)",
        color: isHigh ? "var(--ft-poor)" : "var(--ft-subtle)",
      }}
    >
      COI {pct}%
    </span>
  );
}

function RiskChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
      style={{
        background: "rgba(192,87,76,0.10)",
        color: "var(--ft-poor)",
        border: "1px solid rgba(192,87,76,0.2)",
      }}
    >
      {label}
    </span>
  );
}

function TraitDot({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const color =
    value >= 70 ? "var(--ft-good)" : value >= 40 ? "var(--ft-fair)" : "var(--ft-poor)";
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs" style={{ color: "var(--ft-subtle)" }}>
        {label}
      </span>
      <span className="text-xs font-medium tabular-nums" style={{ color }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

function KPICard({
  label,
  value,
  status = "neutral",
  icon,
}: {
  label: string;
  value: number;
  status?: keyof typeof STATUS_COLORS;
  icon?: string;
}) {
  const c = STATUS_COLORS[status];
  return (
    <div
      className="rounded-2xl overflow-hidden border"
      style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
    >
      <div className="h-1" style={{ background: c.bar }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ft-subtle)" }}>
              {label}
            </p>
            <p className="text-3xl font-bold mt-1 font-mono leading-none" style={{ color: "var(--ft-text)" }}>
              {value}
            </p>
          </div>
          {icon && <span className="text-2xl opacity-50 shrink-0 leading-none mt-0.5">{icon}</span>}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-semibold mb-3" style={{ color: "var(--ft-text)" }}>
      {children}
    </h2>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border p-5 ${className ?? ""}`}
      style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
    >
      {children}
    </div>
  );
}

export default function BreedingDashboard({
  snapshot,
  pairings,
  inbreedingRisks,
  farmSlug,
}: BreedingDashboardProps) {
  const [aiResult, setAiResult] = useState<BreedingAIResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hideRisky, setHideRisky] = useState(false);

  async function handleAnalyze() {
    setLoading(true);
    setAiError(null);
    setAiResult(null);

    try {
      const res = await fetch(`/api/${farmSlug}/breeding/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmSlug }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        if (res.status === 400) {
          setAiError("OpenAI API key not configured. Add it under Settings.");
        } else {
          setAiError(data.error ?? `Request failed (${res.status})`);
        }
        return;
      }

      const data = await res.json() as BreedingAIResponse;
      setAiResult(data);
      setExpanded(true);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  const calvingStatus =
    snapshot.expectedCalvingsThisMonth > 5
      ? "alert"
      : snapshot.expectedCalvingsThisMonth > 0
        ? "warning"
        : "good";

  // Filter pairings based on risk toggle
  const filteredPairings = hideRisky
    ? pairings.filter((p) => p.coi <= 0.03125)
    : pairings;

  return (
    <div className="space-y-8">
      {/* KPI Row */}
      <div>
        <SectionTitle>Herd Overview</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard label="Bulls in Service" value={snapshot.bullsInService} status="neutral" icon="🐂" />
          <KPICard label="Pregnant Cows" value={snapshot.pregnantCows} status="good" icon="🐄" />
          <KPICard label="Open Cows" value={snapshot.openCows} status={snapshot.openCows > 0 ? "warning" : "good"} icon="🔓" />
          <KPICard label="Calvings This Month" value={snapshot.expectedCalvingsThisMonth} status={calvingStatus} icon="🐣" />
        </div>
      </div>

      {/* Inbreeding Warnings */}
      {inbreedingRisks.length > 0 && (
        <div>
          <SectionTitle>Inbreeding Warnings</SectionTitle>
          <div
            className="rounded-xl border p-5 space-y-2"
            style={{ background: "rgba(139,105,20,0.05)", borderColor: "rgba(139,105,20,0.3)" }}
          >
            <p className="text-sm font-semibold" style={{ color: "var(--ft-fair)" }}>
              {inbreedingRisks.length} potential inbreeding {inbreedingRisks.length === 1 ? "risk" : "risks"} detected
            </p>
            <ul className="space-y-1">
              {inbreedingRisks.map((risk, i) => (
                <li key={i} className="text-sm" style={{ color: "#6B5B3E" }}>
                  <span className="font-medium">{risk.tag}</span> &amp;{" "}
                  <span className="font-medium">{risk.relatedTag}</span>
                  {" — "}
                  <span className="capitalize">
                    {risk.riskType.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Pairing Suggestions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Suggested Pairings</SectionTitle>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideRisky}
              onChange={(e) => setHideRisky(e.target.checked)}
              className="rounded border-[var(--ft-border)] text-[var(--ft-good)] focus:ring-[var(--ft-good)]"
            />
            <span className="text-xs font-medium" style={{ color: "var(--ft-subtle)" }}>
              Hide risky (COI &gt; 3.125%)
            </span>
          </label>
        </div>
        <Card>
          {filteredPairings.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ft-subtle)" }}>
              {pairings.length === 0
                ? "No pairings available. Ensure there are active bulls and open cows with lineage data."
                : "All pairings filtered out. Uncheck the filter to see risky pairings."}
            </p>
          ) : (
            <div className="space-y-3">
              {filteredPairings.map((p, i) => (
                <div
                  key={i}
                  className="rounded-2xl border p-4"
                  style={{ borderColor: "var(--ft-border)", background: "var(--ft-bg)" }}
                >
                  {/* Header row: tags, score, COI */}
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-sm font-bold" style={{ color: "var(--ft-text)" }}>
                        {p.bullTag}
                      </span>
                      <span className="text-xs" style={{ color: "var(--ft-subtle)" }}>x</span>
                      <span className="font-mono text-sm font-medium" style={{ color: "#4A3728" }}>
                        {p.cowTag}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <CoiBadge coi={p.coi} />
                      <ScoreBadge score={p.score} />
                    </div>
                  </div>

                  {/* Risk flags */}
                  {p.riskFlags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {p.riskFlags.map((flag, fi) => (
                        <RiskChip key={fi} label={flag} />
                      ))}
                    </div>
                  )}

                  {/* Trait breakdown */}
                  {p.traitBreakdown && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
                      <TraitDot label="Growth" value={p.traitBreakdown.growth} />
                      <TraitDot label="Fertility" value={p.traitBreakdown.fertility} />
                      <TraitDot label="Calving" value={p.traitBreakdown.calvingEase} />
                      <TraitDot label="Temper." value={p.traitBreakdown.temperament} />
                    </div>
                  )}

                  {/* Reason */}
                  <p className="text-xs leading-relaxed" style={{ color: "#6B5B3E" }}>
                    {p.reason}
                  </p>
                </div>
              ))}
              {pairings.length > filteredPairings.length && (
                <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>
                  Showing {filteredPairings.length} of {pairings.length} pairings (risky pairings hidden)
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* AI Recommendations */}
      <div>
        <SectionTitle>AI Breeding Recommendations</SectionTitle>
        <Card>
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              style={{
                background: loading ? "rgba(139,105,20,0.3)" : "var(--ft-fair)",
                color: "var(--ft-fair-bg)",
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Analysing..." : "Get AI Recommendations"}
            </button>
            {loading && (
              <div
                className="w-4 h-4 rounded-full border-2 animate-spin"
                style={{ borderColor: "var(--ft-fair)", borderTopColor: "transparent" }}
              />
            )}
          </div>

          {aiError && (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{ background: "rgba(192,87,76,0.08)", color: "var(--ft-poor)", border: "1px solid rgba(192,87,76,0.2)" }}
            >
              {aiError}
            </div>
          )}

          {aiResult && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold" style={{ color: "var(--ft-good)" }}>
                  Analysis complete
                </p>
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-xs underline"
                  style={{ color: "var(--ft-fair)" }}
                >
                  {expanded ? "Collapse" : "Expand"}
                </button>
              </div>

              {expanded && (
                <div className="space-y-4 pt-2" style={{ borderTop: "1px solid var(--ft-border)" }}>
                  {/* Summary */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--ft-subtle)" }}>Summary</p>
                    <p className="text-sm" style={{ color: "#4A3728" }}>{aiResult.summary}</p>
                  </div>

                  {/* Bull Recommendations */}
                  {aiResult.bullRecommendations?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--ft-subtle)" }}>Bull Recommendations</p>
                      <ul className="space-y-1">
                        {aiResult.bullRecommendations.map((rec, i) => (
                          <li key={i} className="text-sm flex gap-2" style={{ color: "#4A3728" }}>
                            <span style={{ color: "var(--ft-fair)" }}>•</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Calving Alerts */}
                  {aiResult.calvingAlerts?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--ft-subtle)" }}>Calving Alerts</p>
                      <ul className="space-y-1">
                        {aiResult.calvingAlerts.map((alert, i) => (
                          <li key={i} className="text-sm flex gap-2" style={{ color: "var(--ft-poor)" }}>
                            <span>!</span>
                            <span>{alert}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Breeding Window Suggestion */}
                  {aiResult.breedingWindowSuggestion && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--ft-subtle)" }}>Breeding Window</p>
                      <p className="text-sm" style={{ color: "#4A3728" }}>{aiResult.breedingWindowSuggestion}</p>
                    </div>
                  )}

                  {/* Risk Flags */}
                  {aiResult.riskFlags?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--ft-subtle)" }}>Risk Flags</p>
                      <ul className="space-y-1">
                        {aiResult.riskFlags.map((flag, i) => (
                          <li key={i} className="text-sm flex gap-2" style={{ color: "var(--ft-poor)" }}>
                            <span>!</span>
                            <span>{flag}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Upcoming Calvings Calendar */}
      {snapshot.calendarEntries.length > 0 && (
        <div>
          <SectionTitle>Upcoming Calvings (Next 60 Days)</SectionTitle>
          <Card>
            <ul className="space-y-2">
              {snapshot.calendarEntries.map((entry, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-4 py-2"
                  style={{ borderBottom: i < snapshot.calendarEntries.length - 1 ? "1px solid var(--ft-surface)" : "none" }}
                >
                  <span className="font-mono text-sm font-medium" style={{ color: "var(--ft-text)" }}>
                    {entry.animalTag}
                  </span>
                  <span className="text-sm" style={{ color: "var(--ft-subtle)" }}>
                    {new Date(entry.expectedDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                  <CalvingCountdownBadge expectedDate={entry.expectedDate} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
