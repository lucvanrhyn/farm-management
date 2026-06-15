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
  const rows = (await scoped(prisma, speciesId).animal.findMany({
    select: TRIAGE_ANIMAL_SELECT,
    take: 10_000,
  })) as unknown as TriageAnimal[];

  if (rows.length === 0) return [];

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
      findings.push({ animalId, reasonId: "poor-doer", species: "cattle" });
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
        findings.push({ animalId, reasonId: "dosing-overdue", species: "sheep" });
      }
    }
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
