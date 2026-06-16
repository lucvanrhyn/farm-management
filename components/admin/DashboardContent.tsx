import Link from "next/link";
import type { PrismaClient } from "@prisma/client";
import DangerZone from "@/components/admin/DangerZone";
import NeedsAttentionPanel from "@/components/admin/NeedsAttentionPanel";
import DoNextPanel from "@/components/admin/DoNextPanel";
import DataHealthCard from "@/components/admin/DataHealthCard";
import ThisWeekBriefing from "@/components/admin/ThisWeekBriefing";
import { Card, StatusDot, Label, Icon, Spark, makeSpark } from "@/components/ds";
import {
  getCachedDashboardOverviewByMode,
  getCachedDashboardOverviewShared,
  getCachedFarmSettings,
} from "@/lib/server/cached";
import { getSession } from "@/lib/auth";
import { getTriage } from "@/lib/server/triage/get-triage";
import type { AttentionItem } from "@/lib/server/triage/types";
import { getDoNextFeed, type DoNextItem } from "@/lib/server/nudges/feed";
import { isActionAlreadyScheduled } from "@/lib/server/nudges/task-dedup";
import { getWeeklyBriefingForFarm } from "@/lib/server/briefing/send-weekly-briefing";
import type { BriefingPayload } from "@/lib/server/briefing/payload";
import type { FarmTier } from "@/lib/tier";
import type { SpeciesId } from "@/lib/species/types";
import type { Status } from "@/components/ds";

/**
 * Per-animal Herd Triage teaser for the dashboard NeedsAttentionPanel
 * (decision 10a). Fail-open: triage is a teaser, never load-bearing, so any
 * tenant-DB blip degrades to "no teaser" instead of taking down the dashboard.
 * mode threads the active-species switcher so the teaser tracks the page.
 */
async function loadTriageTeaser(
  prisma: PrismaClient,
  farmSlug: string,
  mode: SpeciesId,
): Promise<AttentionItem[]> {
  try {
    const settings = await prisma.farmSettings.findFirst();
    const thresholds = {
      adgPoorDoerThreshold: settings?.adgPoorDoerThreshold ?? 0.7,
      calvingAlertDays: settings?.calvingAlertDays ?? 14,
      daysOpenLimit: settings?.daysOpenLimit ?? 365,
      campGrazingWarningDays: settings?.campGrazingWarningDays ?? 7,
      staleCampInspectionHours: settings?.alertThresholdHours ?? 48,
    };
    return await getTriage(prisma, farmSlug, thresholds, mode);
  } catch {
    return [];
  }
}

/**
 * Proactive Nudges v1 (decision 10a) — the ranked "Do Next" feed + the
 * "already scheduled" flags for the dashboard DoNextPanel. Fail-open: the panel
 * is a teaser, never load-bearing, so any tenant-DB blip degrades to "no panel"
 * instead of taking the dashboard down (mirrors loadTriageTeaser).
 */
async function loadDoNext(
  prisma: PrismaClient,
  farmSlug: string,
  userEmail: string,
): Promise<{ items: DoNextItem[]; scheduledIds: string[] }> {
  try {
    if (!userEmail) return { items: [], scheduledIds: [] };
    const items = await getDoNextFeed(farmSlug, userEmail);
    // Flag the actions task-dedup already recognises as pending tasks, so the
    // panel shows "already scheduled" rather than a duplicate add-task button.
    const flags = await Promise.all(
      items.map((it) => isActionAlreadyScheduled(prisma, it.action)),
    );
    const scheduledIds = items
      .filter((_, i) => flags[i])
      .map((it) => it.id);
    return { items, scheduledIds };
  } catch {
    return { items: [], scheduledIds: [] };
  }
}

/**
 * Weekly Farm Briefing v1 (decision 8) — the deterministic "This week" payload
 * for the in-app card. ALWAYS on (no audience gate, no LLM — the dashboard hot
 * path uses ONLY the deterministic payload; narration is reserved for the weekly
 * email). Fail-open: any tenant-DB blip degrades to "no card" instead of taking
 * the dashboard down (mirrors loadTriageTeaser / loadDoNext). Returns null on
 * any error so the card simply does not mount.
 */
async function loadThisWeek(
  prisma: PrismaClient,
  farmSlug: string,
  userEmail: string,
  attentionItems: AttentionItem[],
  doNext: DoNextItem[],
): Promise<BriefingPayload | null> {
  try {
    const settings = await getCachedFarmSettings(farmSlug);
    // Reuse the triage + do-next this render already loaded (teaser + panel) so
    // the always-on briefing card does NOT re-run getTriage — that would run the
    // dashboard's heaviest reads twice on the hottest authenticated page (F1).
    return await getWeeklyBriefingForFarm(
      prisma,
      farmSlug,
      userEmail,
      settings.farmName,
      undefined,
      { attentionItems, doNext },
    );
  } catch {
    return null;
  }
}

interface Props {
  farmSlug: string;
  prisma: PrismaClient;
  tier: FarmTier;
  /**
   * Active FarmMode (issue #225). Threaded through to the cached overview
   * helper so cache keys split by species AND every per-species figure
   * (active animal count, pregnancy rate, health issues this week, etc.)
   * reflects the selected mode.
   */
  mode: SpeciesId;
  /** Tenant's resolved assistant name (assistant-name contract — never hardcode "Einstein"). */
  assistantName: string;
}

// ── Presentational KPI tile (command layout) ─────────────────────────────────
// Token-driven .ft-card surface tile: icon + status dot, big tabnums value,
// label + sub. The value text node is followed by the label text with ONLY a
// closing </span> between them (no intervening opening element) so the tolerant
// e2e greps — `(\d[\d,]*)\s*(?:</[^>]+>\s*)*Total Animals` etc — keep matching.
function KpiTile({
  icon: IconEl,
  iconColor,
  value,
  label,
  sub,
  status,
  spark,
  accentValue,
  href,
}: {
  icon: React.ReactNode;
  iconColor: string;
  value: React.ReactNode;
  label: string;
  sub?: React.ReactNode;
  status: Status;
  spark?: number[];
  accentValue?: Status;
  href: string;
}) {
  const valueColor = accentValue
    ? { good: "var(--ft-good)", fair: "var(--ft-fair)", poor: "var(--ft-poor)", critical: "var(--ft-crit)" }[accentValue]
    : "var(--ft-text)";
  return (
    <Link
      href={href}
      className="ft-card ft-card-interactive flex flex-col"
      style={{ padding: "var(--ft-card-pad)", cursor: "pointer" }}
    >
      <div className="flex items-start justify-between">
        <span style={{ color: iconColor }}>{IconEl}</span>
        <StatusDot status={status} />
      </div>
      <div className="mt-3 flex items-end gap-2">
        {/* The wrapping span carries the label-style; the value span overrides
            with the big tabnums treatment. CRITICAL: the label text must sit
            directly after the value span with ONLY a closing tag between them
            so the tolerant e2e greps —
            `(\d[\d,]*)\s*(?:</[^>]+>\s*)*Total Animals` (admin-journey,
            dashboard-counter-stability, multi-species-toggle specs) — keep
            matching. Do NOT interpose a unit/opening element between the value
            digits and the label; per-tile units live in the `sub` caption. */}
        <span
          style={{ fontSize: 12.5, color: "var(--ft-muted)", lineHeight: 1 }}
        >
          <span
            className="ft-tabnums"
            data-ft-ticker
            style={{ fontSize: 34, fontWeight: 600, lineHeight: 1, color: valueColor, letterSpacing: "-0.01em", display: "block", marginBottom: 8 }}
          >
            {value}
          </span>
          {label}
        </span>
        {spark && <Spark values={spark} w={56} h={18} color="var(--ft-good)" className="mb-0.5" />}
      </div>
      {sub && (
        <div className="mt-1.5" style={{ fontSize: 11.5, color: "var(--ft-subtle)", lineHeight: 1.45 }}>
          {sub}
        </div>
      )}
    </Link>
  );
}

export default async function DashboardContent({ farmSlug, prisma, tier, mode, assistantName }: Props) {
  const isBasic = tier === "basic";

  const session = await getSession();
  const isAdmin = (session?.user?.role as string | undefined) === "ADMIN";
  const userEmail = (session?.user?.email as string | undefined) ?? "";

  // Two cached calls in parallel (issue #414):
  //   - by-mode bundle keyed on (slug, mode) — species-dependent tiles
  //   - shared bundle keyed on (slug) only — mode-independent tiles
  // Splitting the cache key for mode-independent values fixes the #411
  // `totalCamps` drift between cattle / sheep views: the shared entry
  // survives a FarmMode flip so the KPI tile stays stable.
  // `loadDoNext` (Proactive Nudges v1) joins the batch — fail-open, so it
  // never blocks the dashboard if the notification feed errors.
  const [byMode, shared, triageItems, doNext] = await Promise.all([
    getCachedDashboardOverviewByMode(farmSlug, mode),
    getCachedDashboardOverviewShared(farmSlug),
    loadTriageTeaser(prisma, farmSlug, mode),
    loadDoNext(prisma, farmSlug, userEmail),
  ]);
  // Weekly Briefing card runs AFTER the batch so it can reuse the triage +
  // do-next just loaded above instead of recomputing getTriage (F1 hot-path
  // fix). Its remaining reads (notifications + 7-day key changes) are still
  // fail-open inside loadThisWeek.
  const thisWeek = await loadThisWeek(prisma, farmSlug, userEmail, triageItems, doNext.items);
  const {
    totalAnimals,
    reproStats,
    healthIssuesThisWeek,
    recentHealth,
    deathsToday,
    birthsToday,
    mtdTransactions,
    dashboardAlerts,
  } = byMode;
  const {
    totalCamps,
    inspectedToday,
    lowGrazingCount,
    withdrawalCount,
    dataHealth,
  } = shared;
  const liveConditions = new Map(Object.entries(shared.liveConditions));

  // ── Finance MTD ──────────────────────────────────────────────────────────────
  let mtdBalance = 0;
  for (const tx of mtdTransactions) {
    if (tx.type === "income") mtdBalance += tx.amount;
    else mtdBalance -= tx.amount;
  }
  const mtdFormatted = (() => {
    const abs = Math.abs(Math.round(mtdBalance));
    const formatted = abs.toLocaleString("en-ZA");
    return mtdBalance < 0 ? `−R ${formatted}` : `R ${formatted}`;
  })();

  // ── Poor doers ───────────────────────────────────────────────────────────────
  const poorDoerAlert = dashboardAlerts.amber.find(a => a.id === "poor-doers");
  const poorDoerCount = poorDoerAlert?.count ?? 0;

  // ── Camp grazing quality tally ────────────────────────────────────────────────
  const grazingCounts: Record<string, number> = { Good: 0, Fair: 0, Poor: 0, Overgrazed: 0 };
  if (liveConditions.size > 0) {
    for (const status of liveConditions.values()) {
      grazingCounts[status.grazing_quality] = (grazingCounts[status.grazing_quality] ?? 0) + 1;
    }
    const unrecorded = totalCamps - liveConditions.size;
    if (unrecorded > 0) grazingCounts["Fair"] = (grazingCounts["Fair"] ?? 0) + unrecorded;
  } else {
    grazingCounts.Good = 0;
    grazingCounts.Fair = totalCamps;
    grazingCounts.Poor = 0;
    grazingCounts.Overgrazed = 0;
  }

  // ── KPI ribbon — restyle of the real stat-bar values ─────────────────────────
  const inspectionPct = Math.round((inspectedToday / (totalCamps || 1)) * 100);
  const kpis: Array<React.ComponentProps<typeof KpiTile>> = [
    {
      icon: <Icon.animals size={16} />,
      iconColor: "var(--ft-good)",
      value: totalAnimals,
      label: "Total Animals",
      sub: `${totalAnimals.toLocaleString()} head active${withdrawalCount > 0 ? ` · ${withdrawalCount} in withdrawal` : ""}`,
      status: "good",
      accentValue: "good",
      spark: makeSpark("herd", 7),
      href: `/${farmSlug}/admin/animals`,
    },
    {
      icon: <Icon.camps size={16} />,
      iconColor: "var(--ft-muted)",
      value: totalCamps,
      label: "Total Camps",
      sub: lowGrazingCount > 0
        ? `${totalCamps} camps · ${lowGrazingCount} below 7d grazing`
        : `${totalCamps} camps · grazing steady`,
      status: lowGrazingCount > 0 ? "fair" : "good",
      href: `/${farmSlug}/admin/camps`,
    },
    {
      icon: <Icon.check size={16} />,
      iconColor: inspectedToday === totalCamps ? "var(--ft-good)" : "var(--ft-fair)",
      value: `${inspectedToday}/${totalCamps}`,
      label: "Inspections Today",
      sub: `${inspectionPct}% done`,
      status: inspectedToday === totalCamps ? "good" : "fair",
      accentValue: inspectedToday === totalCamps ? "good" : undefined,
      href: `/${farmSlug}/admin/observations`,
    },
    {
      icon: <Icon.health size={16} />,
      iconColor: healthIssuesThisWeek === 0 ? "var(--ft-good)" : healthIssuesThisWeek > 3 ? "var(--ft-crit)" : "var(--ft-poor)",
      value: healthIssuesThisWeek,
      label: "Health Issues · 7d",
      sub: healthIssuesThisWeek === 0
        ? "All clear · no flags this week"
        : `${healthIssuesThisWeek} flags · ${healthIssuesThisWeek > 3 ? "critical — review now" : "monitor affected"}`,
      status: healthIssuesThisWeek === 0 ? "good" : healthIssuesThisWeek > 3 ? "critical" : "poor",
      accentValue: healthIssuesThisWeek === 0 ? "good" : undefined,
      href: `/${farmSlug}/admin/observations`,
    },
    {
      icon: <Icon.calving size={16} />,
      iconColor: birthsToday > 0 ? "var(--ft-good)" : "var(--ft-subtle)",
      value: birthsToday,
      label: "Calvings Today",
      sub: birthsToday > 0 ? "New calvings" : "None today",
      status: birthsToday > 0 ? "good" : "good",
      accentValue: birthsToday > 0 ? "good" : undefined,
      href: `/${farmSlug}/admin/reproduction`,
    },
    {
      icon: <Icon.death size={16} />,
      iconColor: deathsToday > 0 ? "var(--ft-crit)" : "var(--ft-subtle)",
      value: deathsToday,
      label: "Deaths Today",
      sub: deathsToday > 0 ? "Alert" : "None today",
      status: deathsToday > 0 ? "critical" : "good",
      href: `/${farmSlug}/admin/observations`,
    },
    {
      icon: <Icon.treat size={16} />,
      iconColor: withdrawalCount > 0 ? "var(--ft-fair)" : "var(--ft-subtle)",
      value: withdrawalCount,
      label: "In Withdrawal",
      sub: withdrawalCount > 0 ? "Caution" : "All clear",
      status: withdrawalCount > 0 ? "fair" : "good",
      href: `/${farmSlug}/admin/animals`,
    },
    {
      icon: <Icon.trend size={16} />,
      iconColor: poorDoerCount > 0 ? "var(--ft-poor)" : "var(--ft-subtle)",
      value: poorDoerCount,
      label: "Poor Doers",
      sub: poorDoerCount > 0 ? "Monitor" : "All clear",
      status: poorDoerCount > 0 ? "poor" : "good",
      href: `/${farmSlug}/admin/animals`,
    },
    ...(!isBasic ? [{
      icon: <Icon.finance size={16} />,
      iconColor: mtdBalance < 0 ? "var(--ft-poor)" : "var(--ft-good)",
      value: mtdFormatted,
      label: "Revenue · MTD",
      sub: "Finance · MTD",
      status: (mtdBalance < 0 ? "poor" : "good") as Status,
      accentValue: (mtdBalance < 0 ? undefined : "good") as Status | undefined,
      href: `/${farmSlug}/admin/finansies`,
    }] : []),
  ];

  // ── Einstein brief — derived from the same real signals ──────────────────────
  const briefBullets: Array<{ tone: Status; text: string }> = [];
  if (lowGrazingCount > 0) {
    briefBullets.push({
      tone: "critical",
      text: `${lowGrazingCount} ${lowGrazingCount === 1 ? "camp" : "camps"} below 7 days grazing — plan rotations now.`,
    });
  }
  if (healthIssuesThisWeek > 0) {
    briefBullets.push({
      tone: healthIssuesThisWeek > 3 ? "critical" : "poor",
      text: `${healthIssuesThisWeek} health ${healthIssuesThisWeek === 1 ? "issue" : "issues"} logged in the last 7 days — review the affected animals.`,
    });
  }
  if (withdrawalCount > 0) {
    briefBullets.push({
      tone: "fair",
      text: `${withdrawalCount} ${withdrawalCount === 1 ? "animal" : "animals"} in withdrawal — check clearance dates before any sale.`,
    });
  }
  if (briefBullets.length === 0) {
    briefBullets.push(
      { tone: "good", text: "No urgent grazing, health or withdrawal flags — the herd is steady today." },
      { tone: "fair", text: "Keep weigh-ins and camp inspections current to sharpen the trend lines." },
      { tone: "good", text: `Ask ${assistantName} for a weekly grazing forecast or a low-ADG shortlist.` },
    );
  }

  // ── Crit banner summary ──────────────────────────────────────────────────────
  // Low-grazing keeps its own dedicated, clickable alert below (a one-click jump
  // to /admin/performance — issue #369 guards its "{n} camp(s) with <7 days
  // grazing remaining" phrasing). The generic strip handles the remaining urgent
  // signals so the two never duplicate the same line.
  const critItems: string[] = [];
  if (healthIssuesThisWeek > 3) critItems.push(`${healthIssuesThisWeek} health issues this week`);
  if (deathsToday > 0) critItems.push(`${deathsToday} ${deathsToday === 1 ? "death" : "deaths"} today`);

  return (
    <>
      {/* KPI ribbon — responsive grid of command-layout tiles */}
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
      >
        {kpis.map((k) => (
          <KpiTile key={k.label} {...k} />
        ))}
      </div>

      {/* Low-grazing alert — dedicated, clickable jump to camp performance.
          Kept as its own element (not folded into the generic strip below) so
          the farmer gets a one-tap rotation-planning CTA. Issue #369: the space
          before `with` MUST stay an explicit {" "} expression — a bare literal
          space is dropped by the production SWC whitespace strip. */}
      {lowGrazingCount > 0 && (
        <Link
          href={`/${farmSlug}/admin/performance`}
          className="flex items-center gap-2.5 mb-5 ft-card-lift"
          style={{
            padding: "13px 18px",
            background: "var(--ft-crit-bg)",
            border: "1px solid color-mix(in oklab, var(--ft-crit) 35%, transparent)",
            borderRadius: "var(--ft-r)",
            color: "var(--ft-crit)",
          }}
        >
          <Icon.alerts size={17} />
          <span className="ft-mono" style={{ fontSize: 10.5, letterSpacing: ".14em", fontWeight: 600 }}>GRAZING</span>
          <p className="text-sm font-medium" style={{ color: "var(--ft-crit)" }}>
            {lowGrazingCount}{" "}
            {lowGrazingCount === 1 ? "camp" : "camps"}{" "}
            with &lt;7 days grazing remaining
          </p>
          <span className="ml-auto ft-mono" style={{ fontSize: 11.5, color: "var(--ft-crit)" }}>Plan rotations →</span>
        </Link>
      )}

      {/* Full-width urgent strip — sits directly under the KPI row, summarising
          the urgent health / death signals composed from the same real data.
          Reference desktop-operations.png: the crit strip spans the whole width
          beneath the KPIs rather than being buried in a column. */}
      {critItems.length > 0 && (
        <div
          className="flex items-center gap-2.5 mb-5"
          style={{
            padding: "13px 18px",
            background: "var(--ft-crit-bg)",
            border: "1px solid color-mix(in oklab, var(--ft-crit) 35%, transparent)",
            borderRadius: "var(--ft-r)",
            color: "var(--ft-crit)",
          }}
        >
          <Icon.alerts size={17} />
          <span className="ft-mono" style={{ fontSize: 10.5, letterSpacing: ".14em", fontWeight: 600 }}>URGENT</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{critItems.join(" · ")}</span>
        </div>
      )}

      {/* ── Primary hero — 2-column: NEEDS ATTENTION (left) + Einstein
          TODAY'S BRIEF (right). Reference desktop-operations.png. The rest of
          the real cards (reproduction, recent activity, camp status, feed,
          quick actions, data health) are kept as secondary sections below. */}
      <div className="grid gap-4 items-start grid-cols-1 lg:grid-cols-[1.25fr_1fr] mb-4">
        {/* Hero left — Proactive Nudges "Do Next" feed (#566) above Needs
            Attention (#565 per-animal Herd Triage teaser). Both are fail-open
            and self-hide when empty. */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Proactive Nudges v1 — one-tap "Do Next" actions (fail-open: the
              loader returns no items on any error, so the panel self-hides). */}
          <DoNextPanel
            items={doNext.items}
            farmSlug={farmSlug}
            scheduledIds={doNext.scheduledIds}
            createdBy={userEmail}
          />
          <NeedsAttentionPanel alerts={dashboardAlerts} farmSlug={farmSlug} triage={triageItems} />
        </div>

        {/* Hero right — Einstein "Today's Brief" rotating border-beam card */}
        <Card className="ft-brief min-w-0" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px" }}>
            <div className="flex items-center gap-2.5 mb-3" style={{ color: "var(--ft-accent)" }}>
              <Icon.einstein size={17} />
              <span className="ft-mono" style={{ fontSize: 10.5, letterSpacing: ".16em", fontWeight: 600 }}>{assistantName.toUpperCase()} · TODAY&apos;S BRIEF</span>
              <span className="flex-1" />
              <span className="ft-mono" style={{ fontSize: 10, color: "var(--ft-subtle)" }}>06:00</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {briefBullets.map((b, i) => (
                <div key={i} className="flex items-start gap-2.5" style={{ fontSize: 13.5, color: "var(--ft-muted)", lineHeight: 1.5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, marginTop: 5, flexShrink: 0, background: { good: "var(--ft-good)", fair: "var(--ft-fair)", poor: "var(--ft-poor)", critical: "var(--ft-crit)" }[b.tone] }} />
                  <span>{b.text}</span>
                </div>
              ))}
            </div>
            <div className="mt-3.5 flex gap-2">
              <Link href={`/${farmSlug}/admin/einstein`} className="ft-btn ft-btn-primary" style={{ fontSize: 12, padding: "7px 12px" }}>
                <Icon.einstein size={13} /> Open advisor
              </Link>
              <Link href={`/${farmSlug}/admin/performance`} className="ft-btn" style={{ fontSize: 12, padding: "7px 12px" }}>
                Plan rotations
              </Link>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Secondary sections — all the remaining real cards, kept below the
          hero. 3-column dense grid: 1col (mobile) → 2col (lg) → 1.3/1/.9 (xl). */}
      <div className="grid gap-4 items-start grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1.3fr_1fr_.9fr]">
        {/* Column 1 — reproduction overview */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Reproductive overview — locked for basic tier */}
          {isBasic ? (
            <Card className="flex flex-col" style={{ padding: "var(--ft-card-pad)" }}>
              <div className="flex items-center gap-2 mb-3">
                <Icon.locate size={14} style={{ color: "var(--ft-fair)" }} />
                <Label>Advanced Features</Label>
              </div>
              <p className="text-xs mb-4 flex-1" style={{ color: "var(--ft-muted)" }}>
                Upgrade to unlock Reproductive Analytics, Financial Tracking, and detailed Performance reports.
              </p>
              <Link href={`/${farmSlug}/subscribe/upgrade`} className="ft-btn ft-btn-primary justify-center">
                Upgrade to Advanced
              </Link>
            </Card>
          ) : (
            <Card style={{ padding: "var(--ft-card-pad)" }}>
              <Label className="block mb-3">Reproductive Overview</Label>
              {reproStats.inseminations30d === 0 &&
               reproStats.inHeat7d === 0 &&
               reproStats.calvingsDue30d === 0 &&
               reproStats.pregnancyRate === null &&
               reproStats.upcomingCalvings.length === 0 &&
               reproStats.scanCounts.pregnant === 0 &&
               reproStats.scanCounts.empty === 0 ? (
                <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>No reproductive events recorded yet.</p>
              ) : (
                <div>
                  {reproStats.pregnancyRate !== null && reproStats.pregnancyRate < 70 && (
                    <div
                      className="flex items-center gap-2 mb-3"
                      style={{ padding: "8px 12px", borderRadius: "var(--ft-r-sm)", background: "var(--ft-fair-bg)", border: "1px solid color-mix(in oklab, var(--ft-fair) 30%, transparent)" }}
                    >
                      <Icon.alerts size={13} style={{ color: "var(--ft-fair)" }} />
                      <p className="text-xs font-medium" style={{ color: "var(--ft-fair)" }}>Below SA target (&lt;70%)</p>
                    </div>
                  )}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: "var(--ft-muted)" }}>Pregnancy Rate</span>
                      <span className="text-sm font-bold ft-mono ft-tabnums" style={{ color: reproStats.pregnancyRate === null ? "var(--ft-subtle)" : reproStats.pregnancyRate >= 85 ? "var(--ft-good)" : reproStats.pregnancyRate >= 70 ? "var(--ft-fair)" : "var(--ft-crit)" }}>
                        {reproStats.pregnancyRate !== null ? `${reproStats.pregnancyRate}%` : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between" style={{ borderTop: "1px dashed var(--ft-border2)", paddingTop: "0.75rem" }}>
                      <span className="text-xs" style={{ color: "var(--ft-muted)" }}>Calvings Due · 30d</span>
                      <span className="text-sm font-bold ft-mono ft-tabnums" style={{ color: reproStats.calvingsDue30d > 0 ? "var(--ft-fair)" : "var(--ft-text)" }}>
                        {reproStats.calvingsDue30d}
                      </span>
                    </div>
                    <div className="flex items-center justify-between" style={{ borderTop: "1px dashed var(--ft-border2)", paddingTop: "0.75rem" }}>
                      <span className="text-xs" style={{ color: "var(--ft-muted)" }}>In Heat · 7d</span>
                      <span className="text-sm font-bold ft-mono ft-tabnums" style={{ color: "var(--ft-text)" }}>
                        {reproStats.inHeat7d}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <Link
                href={`/${farmSlug}/admin/reproduction`}
                className="mt-4 text-xs font-medium text-right block transition-opacity hover:opacity-70 ft-mono"
                style={{ color: "var(--ft-accent)" }}
              >
                View Reproduction →
              </Link>
            </Card>
          )}
        </div>

        {/* Column 2 — Weekly Briefing (#567) + recent activity timeline
            (Einstein brief is now in the hero above) */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Weekly Farm Briefing v1 (decision 8) — the deterministic "This
              week" card. ALWAYS on; fail-open via loadThisWeek (null → no
              card), so a tenant-DB blip never takes the dashboard down. The
              Einstein "Today's Brief" lives in the hero above, so it is not
              duplicated in this column. */}
          {thisWeek && <ThisWeekBriefing payload={thisWeek} farmSlug={farmSlug} />}

          {/* Recent activity — restyle of "Recent Health Incidents" timeline */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div className="flex items-center justify-between" style={{ padding: "15px 20px 11px", borderBottom: "1px solid var(--ft-border)" }}>
              <Label>Recent Activity</Label>
              <span className="ft-mono" style={{ fontSize: 11, color: "var(--ft-subtle)" }}>24h</span>
            </div>
            {recentHealth.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--ft-subtle)", padding: "14px 20px" }}>No health incidents recorded.</p>
            ) : (
              recentHealth.map((obs, i, arr) => (
                <div
                  key={obs.id}
                  className="flex gap-3"
                  style={{ padding: "12px 20px", borderBottom: i < arr.length - 1 ? "1px solid var(--ft-border)" : 0 }}
                >
                  <span className="ft-mono" style={{ fontSize: 10.5, color: "var(--ft-subtle)", minWidth: 70, paddingTop: 2 }}>
                    {obs.observedAt.split("T")[0]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="ft-mono" style={{ fontSize: 13, lineHeight: 1.4, color: "var(--ft-text)" }}>
                      {obs.animalId ?? "Unknown"} · Camp {obs.campId}
                    </div>
                    <div className="ft-mono" style={{ fontSize: 9.5, color: "var(--ft-subtle)", marginTop: 3 }}>
                      {Array.isArray(obs.details.symptoms) ? obs.details.symptoms.join(", ") : "Health issue"} · health
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>

        {/* Column 3 — camp status, feed-on-offer sparkline, quick actions */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Camp status summary */}
          <Card style={{ padding: "var(--ft-card-pad)" }}>
            <Label className="block mb-3">Camp Status Summary</Label>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {[
                ...Array(grazingCounts.Good ?? 0).fill({ color: "var(--ft-good)", label: "Good" }),
                ...Array(grazingCounts.Fair ?? 0).fill({ color: "var(--ft-fair)", label: "Fair" }),
                ...Array(grazingCounts.Poor ?? 0).fill({ color: "var(--ft-poor)", label: "Poor" }),
                ...Array(grazingCounts.Overgrazed ?? 0).fill({ color: "var(--ft-crit)", label: "Overgrazed" }),
              ].map((item: { color: string; label: string }, i: number) => (
                <div
                  key={i}
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: item.color }}
                  title={item.label}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {[
                { label: "Good",       color: "var(--ft-good)", quality: "Good"       },
                { label: "Fair",       color: "var(--ft-fair)", quality: "Fair"       },
                { label: "Poor",       color: "var(--ft-poor)", quality: "Poor"       },
                { label: "Overgrazed", color: "var(--ft-crit)", quality: "Overgrazed" },
              ].map(({ label, color, quality }) => (
                <span key={quality} className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--ft-muted)" }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  {label}
                  <span className="ft-mono font-semibold ft-tabnums" style={{ color: "var(--ft-text)" }}>
                    {grazingCounts[quality] ?? 0}
                  </span>
                </span>
              ))}
            </div>
          </Card>

          {/* Feed on offer · 30d sparkline */}
          <Card style={{ padding: "var(--ft-card-pad)" }}>
            <Label className="block">Feed on Offer · 30d</Label>
            <div className="mt-2">
              <Spark values={makeSpark(`feed-${farmSlug}`, 22)} w={220} h={48} color="var(--ft-fair)" />
            </div>
            <p className="mt-2" style={{ fontSize: 11.5, color: "var(--ft-muted)" }}>
              {lowGrazingCount > 0
                ? "Trending down — plan rotations for the low-grazing camps."
                : "Holding steady across the herd's grazing block."}
            </p>
          </Card>

          {/* Quick actions */}
          <Card style={{ padding: "var(--ft-card-pad)" }}>
            <Label className="block mb-3">Quick Actions</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: <Icon.logger size={18} />, label: "Log Observation", href: `/${farmSlug}/logger` },
                { icon: <Icon.animals size={18} />, label: "View Animals", href: `/${farmSlug}/admin/animals` },
                { icon: <Icon.download size={18} />, label: "View Reports", href: `/${farmSlug}/admin/reports` },
                ...(!isBasic ? [{ icon: <Icon.trend size={18} />, label: "Camp Performance", href: `/${farmSlug}/admin/performance` }] : []),
              ].map(({ icon, label, href }) => (
                <Link
                  key={label}
                  href={href}
                  className="flex flex-col items-center gap-2 transition-colors ft-row-hover"
                  style={{ padding: "16px 12px", borderRadius: "var(--ft-r-sm)", border: "1px solid var(--ft-border)" }}
                >
                  <span style={{ color: "var(--ft-good)" }}>{icon}</span>
                  <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--ft-text)" }}>
                    {label}
                  </span>
                </Link>
              ))}
            </div>
          </Card>

          {/* Data health */}
          <DataHealthCard score={dataHealth} />
        </div>
      </div>

      {isAdmin && (
        <div className="mt-4">
          <DangerZone />
        </div>
      )}
    </>
  );
}
