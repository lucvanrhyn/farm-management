import Link from "next/link";
import type { PrismaClient } from "@prisma/client";
import DangerZone from "@/components/admin/DangerZone";
import NeedsAttentionPanel, { TriageTeaser } from "@/components/admin/NeedsAttentionPanel";
import DoNextPanel from "@/components/admin/DoNextPanel";
import DataHealthCard from "@/components/admin/DataHealthCard";
import ThisWeekBriefing from "@/components/admin/ThisWeekBriefing";
import WeatherWidget from "@/components/dashboard/WeatherWidget";
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
      // Honour the per-farm repeated-treatments config so the dashboard teaser
      // flags the same animals as /admin/triage + /admin/profitability.
      repeatedTreatmentCount: settings?.repeatedTreatmentCount ?? 3,
      repeatedTreatmentWindowDays: settings?.repeatedTreatmentWindowDays ?? 90,
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
  /** Farm coordinates for the body-column weather card (frozen-design Col 3). */
  latitude?: number | null;
  longitude?: number | null;
}

// ── Presentational domain KPI tile (command layout — frozen design) ──────────
// Matches the prototype `DomainTile` in adminlayouts.jsx (measured @1440 from the
// live spec): Card padding 15; top row = 32px accent-faint icon square + 7px
// status dot; value 23px/500 tabnums + inline mono unit; 9.5px uppercase label;
// 11.5px muted sub. The whole tile is a Link to its product area.
//
// e2e contract: admin-journey / dashboard-counter-stability / multi-species
// specs read the live counts. They are migrated to the stable `data-ft-kpi`
// attribute (copy-independent) — the value carries `data-ft-kpi-value` so the
// SSR HTML grep stays robust regardless of label copy. Do NOT remove these.
function KpiTile({
  kpiKey,
  icon: IconEl,
  value,
  unit,
  label,
  sub,
  status,
  valueTone,
  href,
}: {
  kpiKey: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  label: string;
  sub?: React.ReactNode;
  status: Status;
  valueTone?: Status;
  href: string;
}) {
  const valueColor = valueTone
    ? { good: "var(--ft-good)", fair: "var(--ft-fair)", poor: "var(--ft-poor)", critical: "var(--ft-crit)" }[valueTone]
    : "var(--ft-text)";
  return (
    <Link
      href={href}
      data-ft-kpi={kpiKey}
      className="ft-card ft-card-interactive flex flex-col"
      style={{ padding: 15, cursor: "pointer" }}
    >
      <div className="flex items-center justify-between">
        <span
          style={{
            width: 32, height: 32, borderRadius: "var(--ft-r-sm)", flexShrink: 0,
            background: "var(--ft-accent-faint)", color: "var(--ft-accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {IconEl}
        </span>
        <StatusDot status={status} />
      </div>
      <div className="flex items-baseline gap-1.5" style={{ marginTop: 12 }}>
        <span
          className="ft-tabnums"
          data-ft-ticker
          data-ft-kpi-value={kpiKey}
          style={{ fontSize: 23, fontWeight: 500, lineHeight: 1, letterSpacing: "-0.02em", color: valueColor }}
        >
          {value}
        </span>
        {unit && (
          <span className="ft-mono" style={{ fontSize: 11, color: "var(--ft-subtle)" }}>
            {unit}
          </span>
        )}
      </div>
      <div className="ft-label" style={{ fontSize: 9.5, marginTop: 6 }}>{label}</div>
      {sub && (
        <div style={{ fontSize: 11.5, color: "var(--ft-muted)", marginTop: 5, lineHeight: 1.35 }}>
          {sub}
        </div>
      )}
    </Link>
  );
}

/**
 * Compact stat tile for the phone `stat` overview (frozen PA_StatTile,
 * adminmobile.jsx). Icon + tone dot on top, large tabular value, caption below.
 * Phone-only — copy carries no data-ft anchors (the desktop ribbon owns those).
 */
function StatTile({
  icon,
  value,
  caption,
  tone,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  caption: string;
  tone: "good" | "crit" | "fair" | "info" | "muted";
}) {
  const c = {
    good: "var(--ft-good)", crit: "var(--ft-crit)", fair: "var(--ft-fair)",
    info: "var(--ft-info)", muted: "var(--ft-text)",
  }[tone];
  return (
    <Card style={{ padding: 13 }}>
      <div className="flex items-center justify-between" style={{ color: "var(--ft-muted)" }}>
        {icon}
        <span style={{ width: 6, height: 6, borderRadius: 999, background: c }} />
      </div>
      <div className="ft-tabnums" style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 9, lineHeight: 1, color: tone === "muted" ? "var(--ft-text)" : c }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--ft-muted)", marginTop: 5, lineHeight: 1.3 }}>{caption}</div>
    </Card>
  );
}

export default async function DashboardContent({ farmSlug, prisma, tier, mode, assistantName, latitude, longitude }: Props) {
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

  // ── KPI ribbon — the six frozen-design domain tiles (window.DOMAINS), each
  //    mapped to REAL data (never fabricated). Order + labels match the
  //    reference: Animals · Breeding · Camps · Grazing · Finance · Compliance.
  const grazeable = (grazingCounts.Good ?? 0) + (grazingCounts.Fair ?? 0);
  const needRest = (grazingCounts.Poor ?? 0) + (grazingCounts.Overgrazed ?? 0);
  const inCalf = reproStats.scanCounts.pregnant;
  const conception = reproStats.conceptionRate; // real % or null
  const kpis: Array<React.ComponentProps<typeof KpiTile>> = [
    {
      kpiKey: "animals",
      icon: <Icon.animals size={17} />,
      value: totalAnimals,
      unit: "head",
      label: "Animals",
      sub: healthIssuesThisWeek > 0 || withdrawalCount > 0
        ? `${healthIssuesThisWeek} health ${healthIssuesThisWeek === 1 ? "flag" : "flags"} · ${withdrawalCount} in withdrawal`
        : "herd steady · no flags",
      status: "good",
      valueTone: "good",
      href: `/${farmSlug}/admin/animals`,
    },
    {
      kpiKey: "breeding",
      icon: <Icon.breeding size={17} />,
      value: inCalf,
      unit: "in calf",
      label: "Breeding",
      sub: conception != null
        ? `${conception}% conception · ${reproStats.calvingsDue30d} calving 30d`
        : reproStats.calvingsDue30d > 0
          ? `${reproStats.calvingsDue30d} calving in 30d`
          : "no scans recorded",
      status: "good",
      href: `/${farmSlug}/admin/reproduction`,
    },
    {
      kpiKey: "camps",
      icon: <Icon.camps size={17} />,
      value: totalCamps,
      unit: "camps",
      label: "Camps",
      sub: lowGrazingCount > 0 ? `${lowGrazingCount} below 7d grazing` : "grazing steady",
      status: lowGrazingCount > 0 ? "critical" : "good",
      valueTone: lowGrazingCount > 0 ? "critical" : undefined,
      href: `/${farmSlug}/admin/camps`,
    },
    {
      kpiKey: "grazing",
      icon: <Icon.grass size={17} />,
      value: grazeable,
      unit: "grazeable",
      label: "Grazing",
      sub: needRest > 0
        ? `${needRest} need rest · feed ${lowGrazingCount > 0 ? "down" : "steady"}`
        : `feed ${lowGrazingCount > 0 ? "trending down" : "holding"}`,
      status: needRest > 0 ? "fair" : "good",
      href: `/${farmSlug}/admin/grazing`,
    },
    ...(!isBasic ? [{
      kpiKey: "finance",
      icon: <Icon.finance size={17} />,
      value: mtdFormatted,
      unit: "MTD",
      label: "Finance",
      sub: "revenue · month to date",
      status: (mtdBalance < 0 ? "poor" : "good") as Status,
      valueTone: (mtdBalance < 0 ? "poor" : "good") as Status,
      href: `/${farmSlug}/admin/finansies`,
    }] : []),
    {
      kpiKey: "compliance",
      icon: <Icon.reports size={17} />,
      value: `${dataHealth.overall}%`,
      unit: "complete",
      label: "Records",
      sub: (
        <>
          grade {dataHealth.grade} ·{" "}
          <span data-ft-inspections>{inspectedToday}/{totalCamps}</span> inspected today
        </>
      ),
      status: dataHealth.overall >= 85 ? "good" : dataHealth.overall >= 70 ? "fair" : "poor",
      href: `/${farmSlug}/admin/reports`,
    },
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
      {/* ── Phone `stat` overview (frozen PA_OverviewStat, adminmobile.jsx) —
          shown < lg only. Hero count + spark, a 3-up stat row, the Einstein
          brief peek, then the compact Needs-Attention list. The desktop command
          ribbon below carries the data-ft-kpi anchors the e2e specs read, so
          this phone block stays copy-only (no duplicate anchors). */}
      <div className="lg:hidden flex flex-col gap-3.5">
        <Card className="flex items-baseline justify-between" style={{ padding: 18 }}>
          <div>
            <div className="ft-serif ft-tabnums" style={{ fontSize: 46, fontWeight: 500, lineHeight: 0.9, letterSpacing: "-0.03em", color: "var(--ft-text)" }}>
              {totalAnimals}
            </div>
            <div style={{ fontSize: 12, color: "var(--ft-muted)", marginTop: 6 }}>
              animals across {totalCamps} {totalCamps === 1 ? "camp" : "camps"}
            </div>
          </div>
          <Spark values={makeSpark(`herd-${farmSlug}`, 7)} w={96} h={34} color="var(--ft-good)" />
        </Card>
        <div className="grid grid-cols-3 gap-2.5">
          <StatTile icon={<Icon.camps size={15} />} value={totalCamps} caption="Total camps" tone="muted" />
          <StatTile icon={<Icon.health size={15} />} value={healthIssuesThisWeek} caption="Health issues" tone={healthIssuesThisWeek > 0 ? "crit" : "good"} />
          <StatTile icon={<Icon.check size={15} />} value={`${inspectedToday}/${totalCamps}`} caption="Inspected today" tone="info" />
        </div>
        {/* Einstein brief peek — the same real bullets as the desktop brief. */}
        <Card className="ft-brief" style={{ padding: "14px 16px" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 11 }}>
            <div className="flex items-center gap-2" style={{ color: "var(--ft-accent)" }}>
              <Icon.einstein size={15} />
              <span className="ft-mono" style={{ fontSize: 9.5, letterSpacing: ".16em", fontWeight: 600 }}>{assistantName.toUpperCase()} · 06:00</span>
            </div>
            <Link href={`/${farmSlug}/admin/einstein`} className="ft-mono" style={{ fontSize: 10.5, color: "var(--ft-accent)" }}>Ask →</Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {briefBullets.map((b, i) => (
              <div key={i} className="flex items-start gap-2.5" style={{ fontSize: 12.5, color: "var(--ft-muted)", lineHeight: 1.45 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, marginTop: 5, flexShrink: 0, background: { good: "var(--ft-good)", fair: "var(--ft-fair)", poor: "var(--ft-poor)", critical: "var(--ft-crit)" }[b.tone] }} />
                <span>{b.text}</span>
              </div>
            ))}
          </div>
        </Card>
        <NeedsAttentionPanel alerts={dashboardAlerts} farmSlug={farmSlug} />
      </div>

      {/* KPI ribbon — the six frozen-design domain tiles, the desktop command
          layout's control-room header (6-across, gap 10 — the reference @1440).
          Shown lg+ only; the phone `stat` block above replaces it < lg. Carries
          the data-ft-kpi anchors the e2e specs read. */}
      <div className="hidden lg:grid lg:grid-cols-6 gap-2.5">
        {kpis.map((k) => (
          <KpiTile key={k.kpiKey} {...k} />
        ))}
      </div>

      {/* ── Command body — the frozen-design 3-column control room (measured
          1.3fr / 1fr / .9fr, gap 16, margin-top 18). Col 1 = alerts + compact
          Needs-Attention; Col 2 = Einstein Today's Brief + Recent Activity;
          Col 3 = Weather + Feed-on-offer. Shown lg+ only — the phone `stat`
          block above is the < lg surface. Do-Next + the per-animal triage teaser
          are relocated into the "More" disclosure to match the reference, which
          ends Col 1 at the Needs-Attention list (no weigh-in queue). */}
      <div
        className="hidden lg:grid gap-4 items-start lg:grid-cols-[1.3fr_1fr_.9fr]"
        style={{ marginTop: 18 }}
      >
        {/* Col 1 — alerts + compact Needs Attention (reference Col 1 stops here;
            Do-Next + triage live in "More"). */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Low-grazing alert — clickable jump to camp performance. Issue #369:
              the space before `with` MUST stay an explicit {" "} expression — a
              bare literal space is dropped by the production SWC whitespace strip. */}
          {lowGrazingCount > 0 && (
            <Link
              href={`/${farmSlug}/admin/performance`}
              className="flex items-center gap-2.5 ft-card-lift"
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
          {critItems.length > 0 && (
            <div
              className="flex items-center gap-2.5"
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
          <NeedsAttentionPanel alerts={dashboardAlerts} farmSlug={farmSlug} />
        </div>

        {/* Col 2 — Einstein "Today's Brief" beam card + Recent Activity */}
        <div className="flex flex-col gap-4 min-w-0">
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

          {/* Recent activity — health-incident timeline (24h) */}
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

        {/* Col 3 — Weather + Feed-on-offer */}
        <div className="flex flex-col gap-4 min-w-0">
          <WeatherWidget latitude={latitude} longitude={longitude} />
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
        </div>
      </div>

      {/* ── "More" — the frozen-design Operations screen ends after the 3-column
          body above. The remaining real-data panels (reproduction, weekly
          briefing, camp status, quick actions, data health, danger zone) are
          relocated here in a default-collapsed disclosure so the above-fold view
          matches the reference exactly while nothing is lost. */}
      <details className="ft-more mt-4">
        <summary
          className="ft-mono flex items-center gap-2 cursor-pointer select-none"
          style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ft-subtle)", padding: "10px 2px", fontWeight: 600 }}
        >
          <Icon.chevron size={13} className="ft-more-caret" />
          More — do-next, triage, reproduction, weekly briefing, camp status &amp; data health
        </summary>
      {/* Relocated from Col 1 so the above-fold control room matches the
          reference (Col 1 ends at Needs-Attention). The Do-Next nudge queue and
          the per-animal triage teaser stay one tap away — nothing is lost. */}
      <div className="grid gap-4 items-start grid-cols-1 lg:grid-cols-2 mt-4">
        <DoNextPanel
          items={doNext.items}
          farmSlug={farmSlug}
          scheduledIds={doNext.scheduledIds}
          createdBy={userEmail}
        />
        {triageItems.length > 0 && (
          <TriageTeaser triage={triageItems} farmSlug={farmSlug} />
        )}
      </div>
      <div className="grid gap-4 items-start grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1.3fr_1fr_.9fr] mt-4">
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
        </div>

        {/* Column 3 — camp status, quick actions, data health */}
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

          {isAdmin && <DangerZone />}
        </div>
      </div>
      </details>
    </>
  );
}
