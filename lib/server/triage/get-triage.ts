/**
 * lib/server/triage/get-triage.ts — the Herd Triage orchestrator.
 *
 * The group-by-ANIMAL sibling of `getDashboardAlerts`. It:
 *   1. resolves the SAME enabled per-species modules as the alert fan-out
 *      (`getEnabledSpeciesModules`) — cattle always, sheep when enabled,
 *      NEVER cattle-hard-scoped (guards #356);
 *   2. for each enabled species, reads that species' animals + history via
 *      `scoped(prisma, speciesId)`, runs the pure snapshot detectors and the
 *      reused per-species history detectors, and tags every finding with the
 *      species;
 *   3. folds in the cross-species `in-withdrawal` reason (drug-driven, spans
 *      species — projected directly from `getAnimalsInWithdrawal`, which
 *      already carries animalId);
 *   4. projects the flat findings into ranked AttentionItem[].
 *
 * Detection + ranking are FULLY OFFLINE (pure). Only prose (narrate.ts) may
 * be online. All Animal/Observation reads go through scoped()/crossSpecies().
 */

import type { PrismaClient } from "@prisma/client";
import type { SpeciesId } from "@/lib/species/types";
import type { AlertThresholds } from "@/lib/server/dashboard-alerts";
import { getEnabledSpeciesModules } from "@/lib/server/species-modules";
import { scoped } from "@/lib/server/species-scoped-prisma";
import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";
import { getReproStats } from "@/lib/server/reproduction-analytics";
import { detectPoorDoers } from "@/lib/species/cattle/poor-doer";
import { getDosingOverdue } from "@/lib/species/sheep/analytics";
import {
  runSnapshotDetectors,
  type TriageAnimal,
} from "./snapshot-detectors";
import { projectAttentionItems } from "./project";
import type { AttentionItem, Finding } from "./types";

const DOSING_OVERDUE_DAYS = 90;

/** Species we triage per-animal. Game is population-tracked → excluded. */
const PER_ANIMAL_SPECIES = new Set<SpeciesId>(["cattle", "sheep"]);

/**
 * Observation types that count as a treatment/health event for the
 * `repeated-treatments` reason. `treatment` is the same type the withdrawal
 * tracker reads (lib/server/treatment-analytics.ts); `dosing` and
 * `health_check` are the other recurring health interventions a farmer would
 * count as "treated again". Kept as a Set so the observation read can filter
 * on `type in […]` in one query.
 */
const TREATMENT_OBS_TYPES = ["treatment", "dosing", "health_check"] as const;

/**
 * Advisory note attached to `unprofitable` findings. The active roster is
 * UNSOLD, so its per-animal margin is computed from whatever income/cost is
 * tagged so far — a projection, never a banked realised loss. The page firms
 * this up once an animal is sold; triage only ever flags it as advisory.
 */
const UNPROFITABLE_ADVISORY = "projected margin — not a banked loss";

/**
 * `unprofitable` rule (CONTEXT.md "Underperformer flag"): flag an active
 * animal whose realised per-animal margin is NEGATIVE or in the BOTTOM
 * QUARTILE of its OWN category (category-relative, self-calibrating). Only
 * animals with ≥1 tagged transaction are eligible — an untouched animal has
 * unfed data, not a loss. Margin = Σ tag-keyed income − Σ tag-keyed expenses
 * (Transaction.animalId is the TAG, same as Observation.animalId).
 *
 * Pure + deterministic over its inputs so it is unit-testable in isolation.
 */
export function detectUnprofitable(
  animals: ReadonlyArray<{ animalId: string; category: string | null }>,
  taggedTx: ReadonlyArray<{ animalId: string | null; type: string; amount: number }>,
): string[] {
  // Σ income − Σ expense per animal tag, counting only animals with ≥1 tx.
  const margin = new Map<string, number>();
  const touched = new Set<string>();
  for (const tx of taggedTx) {
    if (tx.animalId == null) continue;
    if (tx.type !== "income" && tx.type !== "expense") continue;
    touched.add(tx.animalId);
    const signed = tx.type === "income" ? tx.amount : -tx.amount;
    margin.set(tx.animalId, (margin.get(tx.animalId) ?? 0) + signed);
  }

  // Group the eligible (touched, active) animals by category for the
  // bottom-quartile cut. An animal with no category is its own "" bucket.
  const byCategory = new Map<string, Array<{ animalId: string; margin: number }>>();
  for (const a of animals) {
    if (!touched.has(a.animalId)) continue; // unfed data, not a loss
    const cat = a.category ?? "";
    const entry = { animalId: a.animalId, margin: margin.get(a.animalId) ?? 0 };
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), entry]);
  }

  const flagged: string[] = [];
  for (const group of byCategory.values()) {
    // A negative margin ALWAYS flags (a banked/projected loss). The
    // category-relative bottom-quartile cut only kicks in once the category is
    // big enough (≥4) for a quartile to be meaningful — otherwise a lone or
    // tiny cohort of PROFITABLE animals would be flagged just for being the
    // "bottom" of a cohort of one.
    const sorted = [...group].sort((x, y) => x.margin - y.margin);
    const quartileMargin =
      sorted.length >= 4
        ? sorted[Math.floor(sorted.length / 4) - 1].margin
        : Number.NEGATIVE_INFINITY;
    for (const a of group) {
      if (a.margin < 0 || a.margin <= quartileMargin) flagged.push(a.animalId);
    }
  }
  return flagged;
}

/**
 * `repeated-treatments` rule (CONTEXT.md): flag an active animal with ≥
 * `count` treatment/health observations inside a rolling `windowDays` window.
 * Pure + deterministic over its inputs (the `now` clock is passed in).
 */
export function detectRepeatedTreatments(
  treatmentObs: ReadonlyArray<{ animalId: string | null; observedAt: Date }>,
  windowDays: number,
  count: number,
  now: Date,
): string[] {
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const perAnimal = new Map<string, number>();
  for (const o of treatmentObs) {
    if (o.animalId == null) continue;
    if (o.observedAt < windowStart) continue;
    perAnimal.set(o.animalId, (perAnimal.get(o.animalId) ?? 0) + 1);
  }
  const flagged: string[] = [];
  for (const [animalId, n] of perAnimal) {
    if (n >= count) flagged.push(animalId);
  }
  return flagged;
}

/**
 * Narrow an arbitrary species string (e.g. the cross-species
 * `WithdrawalAnimal.species`) to a per-animal SpeciesId. Returns false for
 * game and any unknown value, so those can never leak onto the per-animal
 * triage list mislabeled as cattle (#356 class).
 */
function isPerAnimalSpecies(species: string): species is SpeciesId {
  return PER_ANIMAL_SPECIES.has(species as SpeciesId);
}

/**
 * The Animal projection the triage detectors need. Selecting only these
 * columns keeps the per-species read narrow (audit-findmany-no-select
 * satisfied) and yields the `TriageAnimal` shape directly.
 */
const TRIAGE_ANIMAL_SELECT = {
  animalId: true,
  species: true,
  currentCamp: true,
  tagNumber: true,
  brandSequence: true,
  dateOfBirth: true,
  category: true,
} as const;

/** Gather every per-animal finding for ONE enabled species. */
async function findingsForSpecies(
  prisma: PrismaClient,
  speciesId: SpeciesId,
  thresholds: AlertThresholds,
  now: Date,
): Promise<Finding[]> {
  // Active animals for this species (scoped injects { species, status:Active }).
  // audit-allow-deceased-flag: scoped() injects status:Active, so deceased are already excluded.
  const rows = (await scoped(prisma, speciesId).animal.findMany({
    select: TRIAGE_ANIMAL_SELECT,
    take: 10_000,
  })) as unknown as TriageAnimal[];

  if (rows.length === 0) return [];

  // The active triage population for this species. The history detectors
  // (poor-doer, dosing-overdue) run over the full Observation history, which
  // — unlike scoped().animal reads — has NO status filter (observations
  // persist after an animal dies or is sold). Intersecting their output with
  // this set keeps triage to currently-active animals only, matching the
  // snapshot detectors (which iterate `rows`) and the in-withdrawal path
  // (status:Active-filtered). Without it, a deceased/sold animal that retains
  // weighing/dosing observations leaks onto the per-animal list.
  const activeIds = new Set<string>(rows.map((a) => a.animalId));

  const findings: Finding[] = [];

  if (speciesId === "cattle") {
    // Weighing history powers BOTH no-weight-on-record (presence) and
    // poor-doer (trend). One read, two detectors.
    const weighing = (await scoped(prisma, "cattle").observation.findMany({
      where: { type: "weighing", animalId: { not: null } },
      select: { animalId: true, observedAt: true, details: true },
      orderBy: { observedAt: "asc" },
      take: 100_000,
    })) as unknown as Array<{ animalId: string | null; observedAt: Date; details: string }>;

    const weighed = new Set<string>();
    for (const o of weighing) if (o.animalId) weighed.add(o.animalId);

    findings.push(...runSnapshotDetectors(rows, weighed, now));

    // poor-doer: reuse the SAME pure detector the cattle alert counts.
    for (const animalId of detectPoorDoers(weighing, thresholds.adgPoorDoerThreshold)) {
      if (!activeIds.has(animalId)) continue; // drop dead/sold animals with stale weighings
      findings.push({ animalId, reasonId: "poor-doer", species: "cattle" });
    }

    // open-cow: cows open beyond the days-open limit. Source = the LIVE,
    // tag-keyed reproduction engine (reproduction-analytics.getReproStats),
    // NOT lib/species/shared/repro-engine.ts (dead cuid/tag filter — its
    // days-open is empty in prod). getReproStats filters observations by
    // type/date only, so obs.animalId (= TAG) flows through to
    // daysOpen[].animalId unbroken. Mirror the dashboard "open beyond limit"
    // filter and intersect with activeIds (drop sold/dead cows with stale
    // calvings). Cattle-only; .catch keeps a repro read failure from sinking
    // the whole species' findings.
    const repro = await getReproStats(prisma, { species: "cattle" }).catch(() => null);
    for (const d of repro?.daysOpen ?? []) {
      const open =
        (d.daysOpen !== null && d.daysOpen > thresholds.daysOpenLimit) ||
        (d.daysOpen === null && d.isExtended);
      if (!open) continue;
      if (!activeIds.has(d.animalId)) continue;
      findings.push({ animalId: d.animalId, reasonId: "open-cow", species: "cattle" });
    }
  } else if (speciesId === "sheep") {
    // Sheep have no weighing-based alert; no-weight-on-record still applies,
    // and self-suppresses when the herd has zero weighings (day-1 import).
    const weighing = (await scoped(prisma, "sheep").observation.findMany({
      where: { type: "weighing", animalId: { not: null } },
      select: { animalId: true },
      take: 100_000,
    })) as unknown as Array<{ animalId: string | null }>;
    const weighed = new Set<string>();
    for (const o of weighing) if (o.animalId) weighed.add(o.animalId);

    findings.push(...runSnapshotDetectors(rows, weighed, now));

    // dosing-overdue: reuse the sheep analytics helper (already returns ids),
    // gated by the SAME active-ewes precondition as the `sheep-dosing-due`
    // alert (lib/species/sheep/index.ts: emitted only when active Ewe/Maiden
    // Ewe count > 0). Sharing the gate keeps the two surfaces one population
    // (ADR-0010): a ram/wether-only flock shows zero dosing on both. The rows
    // are already status:Active (scoped injects it), so counting categories
    // here is free — no extra read, same population by construction.
    const activeEwes = rows.filter(
      (a) => a.category === "Ewe" || a.category === "Maiden Ewe",
    ).length;
    if (activeEwes > 0) {
      const dosing = (await scoped(prisma, "sheep").observation.findMany({
        where: { type: "dosing" },
        select: { animalId: true, observedAt: true },
        take: 100_000,
      })) as unknown as Array<{ animalId: string | null; observedAt: Date }>;
      for (const animalId of getDosingOverdue(dosing, DOSING_OVERDUE_DAYS)) {
        if (!activeIds.has(animalId)) continue; // drop dead/sold animals with stale dosing
        findings.push({ animalId, reasonId: "dosing-overdue", species: "sheep" });
      }
    }
  }

  // ── unprofitable (cross-species, advisory) ────────────────────────────────
  // Self-contained per-animal margin from tag-keyed Transaction rows. Triage
  // owns this calc (does NOT import the profitability page's calc): margin =
  // Σ animalId-tagged income − Σ animalId-tagged expenses, then NEGATIVE or
  // bottom-quartile of its own category is flagged. Transaction.animalId is
  // the TAG (same as Observation.animalId), so it joins to a.animalId. We only
  // pass this species' active animals, so the category cohorts are per-species.
  // Marked advisory: the active roster is unsold → projected, not banked.
  const taggedTx = (await prisma.transaction
    .findMany({
      where: { animalId: { in: [...activeIds] }, type: { in: ["income", "expense"] } },
      select: { animalId: true, type: true, amount: true },
    })
    .catch(() => [])) as Array<{ animalId: string | null; type: string; amount: number }>;
  for (const animalId of detectUnprofitable(rows, taggedTx)) {
    if (!activeIds.has(animalId)) continue;
    findings.push({
      animalId,
      reasonId: "unprofitable",
      species: speciesId,
      advisory: UNPROFITABLE_ADVISORY,
    });
  }

  // ── repeated-treatments (cross-species) ───────────────────────────────────
  // Count treatment/health observations per active animal in the rolling
  // window; flag when count ≥ threshold. scoped().observation reads carry NO
  // status filter (observations persist after death/sale) → intersect with
  // activeIds. animalId is the TAG, group by it directly.
  const treatmentObs = (await scoped(prisma, speciesId).observation
    .findMany({
      where: { type: { in: [...TREATMENT_OBS_TYPES] }, animalId: { not: null } },
      select: { animalId: true, observedAt: true },
      take: 100_000,
    })
    .catch(() => [])) as Array<{ animalId: string | null; observedAt: Date }>;
  // Defaults applied here (the per-caller-default pattern): the AlertThresholds
  // fields are optional so existing callers compile unchanged.
  for (const animalId of detectRepeatedTreatments(
    treatmentObs,
    thresholds.repeatedTreatmentWindowDays ?? 90,
    thresholds.repeatedTreatmentCount ?? 3,
    now,
  )) {
    if (!activeIds.has(animalId)) continue;
    findings.push({ animalId, reasonId: "repeated-treatments", species: speciesId });
  }

  return findings;
}

/**
 * Build the ranked triage list for a farm.
 *
 * @param mode — optional active-species narrowing (mirrors getDashboardAlerts'
 *   `mode`): when set, only that species is triaged. Game is never per-animal,
 *   so a `mode: "game"` yields an empty list by construction.
 */
export async function getTriage(
  prisma: PrismaClient,
  _farmSlug: string,
  thresholds: AlertThresholds,
  mode?: SpeciesId,
): Promise<AttentionItem[]> {
  const now = new Date();

  const allEnabled = await getEnabledSpeciesModules(prisma);
  const enabledSpecies = allEnabled
    .map((m) => m.config.id)
    .filter((id) => PER_ANIMAL_SPECIES.has(id))
    .filter((id) => (mode ? id === mode : true));

  // Per-species snapshot + history findings, in parallel.
  const perSpecies = await Promise.all(
    enabledSpecies.map((id) =>
      findingsForSpecies(prisma, id, thresholds, now).catch(() => [] as Finding[]),
    ),
  );

  const findings: Finding[] = perSpecies.flat();

  // Cross-species in-withdrawal (drug-driven, spans species). Projected
  // directly — WithdrawalAnimal carries the animal's TRUE species (looked up
  // from its Animal row, not guessed). An animal can be in withdrawal with NO
  // other reason, so we add the finding unconditionally — BUT only when the
  // animal's real species is an enabled PER-ANIMAL species. A withdrawal on a
  // disabled species, or on population-tracked game (which has no per-animal
  // triage row), is DROPPED rather than mislabeled cattle (#356 guard).
  const withdrawal = await getAnimalsInWithdrawal(prisma).catch(() => []);
  for (const w of withdrawal) {
    if (!isPerAnimalSpecies(w.species)) continue;
    if (!enabledSpecies.includes(w.species)) continue;
    findings.push({ animalId: w.animalId, reasonId: "in-withdrawal", species: w.species });
  }

  return projectAttentionItems(findings);
}
