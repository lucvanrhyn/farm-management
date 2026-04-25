// lib/server/alerts/cog-breakeven.ts — COG_EXCEEDS_BREAKEVEN (MOAT).
//
// Research brief §D row 8: flag when Cost-of-Gain per kg > marketPrice × 0.85.
// Market price comes from FarmSettings.speciesAlertThresholds (JSON) since
// there is no auction-feed module yet (T3-7 is deferred). If no market price
// is configured for any species, log once and skip — this is a graceful
// degradation per the brief, NOT silent failure: we warn + return [] so the
// dispatcher observes "no cog alerts" not "unknown failure".

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, toIsoWeek } from "./helpers";
import { parseSpeciesThresholds } from "./helpers";

const BREAKEVEN_FRACTION = 0.85;

interface TxnRow {
  type: string;
  category: string;
  amount: number;
  animalId: string | null;
}

interface AnimalRow {
  id: string;
  animalId: string;
  species: string;
}

interface WeightRow {
  animalId: string;
  weightKg: number;
}

export async function evaluate(
  prisma: PrismaClient,
  settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  const speciesThresholds = parseSpeciesThresholds(settings.speciesAlertThresholds);

  // Collect market-price-per-kg per species from settings JSON.
  // Shape: { cattle: { marketPricePerKg: 45.0 }, sheep: { marketPricePerKg: 95.0 } }
  const marketByS: Record<string, number> = {};
  for (const [species, blob] of Object.entries(speciesThresholds)) {
    const raw = blob?.marketPricePerKg;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      marketByS[species] = raw;
    }
  }
  if (Object.keys(marketByS).length === 0) {
    console.warn("[alerts:COG_EXCEEDS_BREAKEVEN] no market prices configured — skipping");
    return [];
  }

  // cross-species by design: alert fires per-animal using a per-species
  // marketByS lookup; the loop below keys on `a.species` row-by-row.
  const animals = (await prisma.animal.findMany({
    where: { status: "Active" },
    select: { id: true, animalId: true, species: true },
  })) as AnimalRow[];
  if (animals.length === 0) return [];

  const animalIds = animals.map((a) => a.id);

  // Pull expense transactions tagged to each animal (feed, treatment, labour).
  const txns = (await prisma.transaction.findMany({
    where: { type: "expense", animalId: { in: animalIds } },
    select: { type: true, category: true, amount: true, animalId: true },
  })) as TxnRow[];

  const spendByAnimal = new Map<string, number>();
  for (const t of txns) {
    if (!t.animalId) continue;
    spendByAnimal.set(t.animalId, (spendByAnimal.get(t.animalId) ?? 0) + (t.amount || 0));
  }

  // Latest weighing per animal (proxy for current body mass).
  const weights = (await prisma.$queryRawUnsafe<WeightRow[]>(
    `SELECT animalId, CAST(json_extract(details, '$.weight_kg') AS REAL) AS weightKg
     FROM Observation
     WHERE type = 'weighing'
       AND animalId IN (${animalIds.map(() => "?").join(",") || "''"})
     ORDER BY observedAt DESC`,
    ...animalIds,
  )) as WeightRow[];

  const latestWeight = new Map<string, number>();
  for (const w of weights) {
    if (!w.animalId || !w.weightKg || w.weightKg <= 0) continue;
    if (!latestWeight.has(w.animalId)) latestWeight.set(w.animalId, w.weightKg);
  }

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);
  const candidates: AlertCandidate[] = [];

  for (const a of animals) {
    const market = marketByS[a.species];
    if (!market) continue;
    const spend = spendByAnimal.get(a.id) ?? 0;
    const weightKg = latestWeight.get(a.id);
    if (!weightKg || weightKg <= 0) continue;

    const cogPerKg = spend / weightKg;
    const breakeven = market * BREAKEVEN_FRACTION;
    if (cogPerKg <= breakeven) continue;

    candidates.push({
      type: "COG_EXCEEDS_BREAKEVEN",
      category: "finance",
      severity: "amber",
      dedupKey: `COG_EXCEEDS_BREAKEVEN:${a.id}:${week}`,
      collapseKey: "tenant",
      payload: {
        animalId: a.animalId,
        animalInternalId: a.id,
        species: a.species,
        cogPerKg: Math.round(cogPerKg * 100) / 100,
        marketPricePerKg: market,
        breakevenPerKg: Math.round(breakeven * 100) / 100,
      },
      message: `${a.animalId}: cost-of-gain R${cogPerKg.toFixed(2)}/kg > ${Math.round(BREAKEVEN_FRACTION * 100)}% of market (R${breakeven.toFixed(2)})`,
      href: `/admin/animals?focus=${encodeURIComponent(a.animalId)}`,
      expiresAt,
    });
  }

  return candidates;
}
