/**
 * lib/server/briefing/payload.ts — Weekly Farm Briefing v1 aggregator.
 *
 * `buildBriefingPayload` is the deterministic SOURCE OF TRUTH for the weekly
 * briefing. It maps each already-fetched source to one of three farmer-facing
 * sections and OMITS a source whose data is empty/absent:
 *
 *   whatChanged  ← 7-day notifications + key changes (weights, repro, deaths,
 *                  sales) — "here's what moved on the farm this week"
 *   whatToWatch  ← top Attention Items (triage) + veld/drought status —
 *                  "here's what's drifting toward trouble"
 *   whatToDo     ← top Recommended Actions (nudges feed) — "here's the
 *                  shortlist of next actions"
 *
 * Graceful degradation is LOAD-BEARING: the in-app card and the email both
 * render exactly what the payload carries and nothing more, and the LLM
 * narrator (narrator.ts) is told to never invent facts beyond this payload.
 * An absent/empty source therefore must yield NO line for its section.
 *
 * PURE + TOTAL: same input → same output, no I/O, no clock read beyond the
 * caller-supplied `now`. Every source→section mapping is unit-tested for an
 * exact value (mirrors the contract `compose.ts` holds for alerts).
 */

import type { AttentionItem } from "@/lib/server/triage/types";
import type { DoNextItem } from "@/lib/server/nudges/feed";
import { pluralize } from "@/lib/server/narration/templated-fallback";
import { narrateTriageItem, narrateHerdGlance } from "@/lib/server/triage/narrate";

/** Max number of per-animal attention lines surfaced in the briefing. */
const TOP_ATTENTION = 5;
/** Max number of recommended-action lines surfaced in the briefing. */
const TOP_ACTIONS = 5;

/**
 * SPI severities that warrant a "watch" line. Mirrors the dry end of
 * `SpiSeverity` (lib/calculators/spi.ts) — anything moderate-or-worse is
 * surfaced; near-normal / wet conditions are not noteworthy for a briefing.
 */
const DRY_SPI_SEVERITIES = new Set<string>([
  "moderate-drought",
  "severe-drought",
  "extreme-drought",
]);

/** A 7-day-window notification row (non-species; raw Notification). */
export interface BriefingNotification {
  id: string;
  type: string;
  severity: string;
  message: string;
  href: string;
  createdAt: string | Date;
}

/** Compact veld read for the briefing (derived from FarmVeldSummary). */
export interface BriefingVeld {
  criticalCamps: number;
  decliningCamps: number;
}

/** Compact drought read for the briefing (derived from DroughtPayload). */
export interface BriefingDrought {
  spiSeverity: string;
  currentMonth: string | null;
}

/** Seven-day "key changes" already aggregated by the fetch shell. */
export interface BriefingKeyChanges {
  weightsLogged: number;
  reproEvents: number;
  deaths: number;
  sales: number;
  veld: BriefingVeld | null;
  drought: BriefingDrought | null;
}

/** All already-fetched sources the aggregator folds into a briefing. */
export interface BriefingSources {
  farmName: string;
  notifications: BriefingNotification[];
  attentionItems: AttentionItem[];
  doNext: DoNextItem[];
  keyChanges: BriefingKeyChanges;
  now: Date;
}

/** The deterministic briefing read model — the source of truth for both
 *  the in-app card and the LLM email narrator. */
export interface BriefingPayload {
  farmName: string;
  whatChanged: string[];
  whatToWatch: string[];
  whatToDo: string[];
  /** True when every section is empty (nothing happened this week). */
  isEmpty: boolean;
}

function toMs(d: string | Date): number {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Build the "what changed" section from notifications + key changes. */
function buildWhatChanged(sources: BriefingSources): string[] {
  const lines: string[] = [];

  // Recent notifications — newest first, red before amber on a tie. We render
  // the top few as headline movements; the rest are summarised by count so a
  // busy week doesn't blow up the briefing.
  const sorted = [...sources.notifications].sort((a, b) => {
    const sev = (a.severity === "red" ? 0 : 1) - (b.severity === "red" ? 0 : 1);
    if (sev !== 0) return sev;
    return toMs(b.createdAt) - toMs(a.createdAt);
  });
  for (const n of sorted.slice(0, 3)) {
    lines.push(n.message);
  }
  if (sorted.length > 3) {
    lines.push(`Plus ${pluralize(sorted.length - 3, "more alert")} this week.`);
  }

  // Key changes — weights + repro events folded into one husbandry line.
  const kc = sources.keyChanges;
  const husbandry: string[] = [];
  if (kc.weightsLogged > 0) husbandry.push(pluralize(kc.weightsLogged, "weighing"));
  if (kc.reproEvents > 0) husbandry.push(pluralize(kc.reproEvents, "reproduction event"));
  if (husbandry.length > 0) {
    lines.push(`${joinAnd(husbandry)} logged this week.`);
  }

  // Deaths / sales — only when non-zero (zero is not news in a briefing).
  const attrition: string[] = [];
  if (kc.deaths > 0) attrition.push(pluralize(kc.deaths, "death"));
  if (kc.sales > 0) attrition.push(`${pluralize(kc.sales, "animal")} sold`);
  if (attrition.length > 0) {
    lines.push(`${joinAnd(attrition)} recorded this week.`);
  }

  return lines;
}

/** Build the "what to watch" section from attention items + veld + drought. */
function buildWhatToWatch(sources: BriefingSources): string[] {
  const lines: string[] = [];

  const items = sources.attentionItems;
  if (items.length > 0) {
    lines.push(narrateHerdGlance(items));
    for (const item of items.slice(0, TOP_ATTENTION)) {
      lines.push(narrateTriageItem(item));
    }
  }

  const veld = sources.keyChanges.veld;
  if (veld && (veld.criticalCamps > 0 || veld.decliningCamps > 0)) {
    const parts: string[] = [];
    if (veld.criticalCamps > 0) parts.push(`${pluralize(veld.criticalCamps, "camp")} in critical veld condition`);
    if (veld.decliningCamps > 0) parts.push(`${pluralize(veld.decliningCamps, "camp")} with declining veld`);
    lines.push(`${joinAnd(parts)} — review grazing.`);
  }

  const drought = sources.keyChanges.drought;
  if (drought && DRY_SPI_SEVERITIES.has(drought.spiSeverity)) {
    const month = drought.currentMonth ? ` (${drought.currentMonth})` : "";
    lines.push(`Drought watch: SPI is at ${humanSpi(drought.spiSeverity)}${month}.`);
  }

  return lines;
}

/** Build the "what to do" section from the ranked nudges feed.
 *  Skips any item without a non-blank action label so the briefing never renders
 *  a degenerate "undefined." / "." line (the feed gate normally guarantees a
 *  string label, but this keeps the deterministic payload total). Filtering
 *  before the cap means a malformed item never consumes one of the TOP_ACTIONS
 *  slots. */
function buildWhatToDo(doNext: DoNextItem[]): string[] {
  return doNext
    .filter((d) => typeof d.action?.label === "string" && d.action.label.trim() !== "")
    .slice(0, TOP_ACTIONS)
    .map((d) => {
      const due = d.dueDate ? ` (due ${d.dueDate})` : "";
      return `${d.action.label}${due}.`;
    });
}

/** Local Oxford-list join (the shared joinClauses lives in templated-fallback,
 *  but for ≤3 short husbandry parts a thin local helper keeps this file's
 *  dependency surface to the two narration primitives it actually needs). */
function joinAnd(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** Friendly label for an SPI severity slug. */
function humanSpi(severity: string): string {
  return severity.replace(/-/g, " ");
}

export function buildBriefingPayload(sources: BriefingSources): BriefingPayload {
  const whatChanged = buildWhatChanged(sources);
  const whatToWatch = buildWhatToWatch(sources);
  const whatToDo = buildWhatToDo(sources.doNext);
  return {
    farmName: sources.farmName,
    whatChanged,
    whatToWatch,
    whatToDo,
    isEmpty: whatChanged.length === 0 && whatToWatch.length === 0 && whatToDo.length === 0,
  };
}
