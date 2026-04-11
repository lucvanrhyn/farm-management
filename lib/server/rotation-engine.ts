// Rotation engine — computes per-camp rotation status for the whole farm.
// Reads Prisma, reuses Observation history and LSU helpers. Side-effect-free
// apart from the single read transaction it issues against the tenant DB.

import type { PrismaClient } from '@prisma/client';
import {
  classifyCampStatus,
  calcCampLsuDays,
  daysBetween,
  rankNextToGraze,
  resolveEffectiveMaxGrazingDays,
  resolveEffectiveRestDays,
  resolveSeasonalMultiplier,
  type CampRotationConfig,
  type RotationSettings,
  type RotationStatus,
  type VeldType,
} from '@/lib/calculators/rotation';
import { getMergedLsuValues } from '@/lib/species/registry';
import { calcLsu } from '@/lib/species/shared/lsu';
import { getLatestByCamp as getLatestVeldByCamp } from './veld-score';

export interface RotationMobSummary {
  readonly mobId: string | null;
  readonly mobName: string;
  readonly animalCount: number;
  readonly lsu: number;
  readonly species: string;
}

export interface CampRotationStatus {
  readonly campId: string;
  readonly campName: string;
  readonly sizeHectares: number | null;
  readonly veldType: VeldType | null;
  readonly rotationNotes: string | null;
  readonly status: RotationStatus;
  readonly currentMobs: ReadonlyArray<RotationMobSummary>;
  readonly totalAnimals: number;
  readonly totalLsu: number;
  readonly daysGrazed: number | null;   // only set when currently grazing
  readonly daysRested: number | null;   // only set when currently resting
  readonly lastDepartedAt: string | null; // ISO
  readonly lastArrivedAt: string | null;  // ISO — mob arrived (start of last graze)
  readonly effectiveRestDays: number;
  readonly effectiveMaxGrazingDays: number;
  readonly restDaysOverride: number | null;
  readonly maxGrazingDaysOverride: number | null;
  readonly nextEligibleDate: string | null; // ISO — when rest target will be met
  readonly capacityLsuDays: number | null;  // forage capacity in LSU-days
  readonly veldScoreAtStatus: number | null; // latest veld score used for rest-day calc
}

export interface RotationPayload {
  readonly now: string; // ISO
  readonly settings: {
    readonly defaultRestDays: number;
    readonly defaultMaxGrazingDays: number;
    readonly rotationSeasonMode: 'auto' | 'growing' | 'dormant';
    readonly dormantSeasonMultiplier: number;
    readonly seasonMultiplierInEffect: number;
    readonly isDormantSeason: boolean;
  };
  readonly camps: ReadonlyArray<CampRotationStatus>;
  readonly nextToGraze: ReadonlyArray<{ campId: string; daysRested: number | null }>;
  readonly counts: {
    readonly grazing: number;
    readonly overstayed: number;
    readonly resting: number;
    readonly restingReady: number;
    readonly overdueRest: number;
    readonly unknown: number;
  };
}

interface MobMovementDetails {
  readonly mobId?: string;
  readonly mobName?: string;
  readonly sourceCamp?: string;
  readonly destCamp?: string;
  readonly animalCount?: number;
}

interface LatestMoveForCamp {
  readonly departedAt: Date | null;
  readonly arrivedAt: Date | null;
}

function parseMoveDetails(raw: string): MobMovementDetails {
  try {
    return JSON.parse(raw) as MobMovementDetails;
  } catch {
    return {};
  }
}

function isValidVeldType(v: string | null | undefined): v is VeldType {
  return v === 'sweetveld' || v === 'sourveld' || v === 'mixedveld' || v === 'cultivated';
}

/**
 * Builds a map of campId → { departedAt, arrivedAt } by scanning all mob_movement
 * observations. "departedAt" = most recent time a mob left the camp.
 * "arrivedAt" = most recent time a mob entered the camp.
 *
 * Observations are already indexed on (type, campId, observedAt), so this query
 * uses that index. We walk the full result set in memory — safe for farms with
 * hundreds of camps and thousands of moves. If this ever gets hot, denormalise
 * onto the Camp row.
 */
async function getLatestMovesByCamp(
  prisma: PrismaClient,
): Promise<Map<string, LatestMoveForCamp>> {
  const rows = await prisma.observation.findMany({
    where: { type: 'mob_movement' },
    orderBy: { observedAt: 'desc' },
    select: { campId: true, observedAt: true, details: true },
  });

  // The PATCH mob route creates two observation rows per move — one with
  // campId = sourceCamp, one with campId = destCamp. We classify each row by
  // parsing its details JSON. Rows are ordered observedAt desc, so the first
  // hit per (camp, direction) wins.
  const result = new Map<string, LatestMoveForCamp>();
  for (const row of rows) {
    const details = parseMoveDetails(row.details);
    const isSource = details.sourceCamp === row.campId;
    const isDest = details.destCamp === row.campId;
    if (!isSource && !isDest) continue;

    const observedAt = row.observedAt instanceof Date ? row.observedAt : new Date(row.observedAt);
    const current = result.get(row.campId) ?? { departedAt: null, arrivedAt: null };

    result.set(row.campId, {
      departedAt: isSource && current.departedAt == null ? observedAt : current.departedAt,
      arrivedAt:  isDest   && current.arrivedAt  == null ? observedAt : current.arrivedAt,
    });
  }
  return result;
}

interface RotationFarmSettings {
  readonly defaultRestDays: number;
  readonly defaultMaxGrazingDays: number;
  readonly rotationSeasonMode: string;
  readonly dormantSeasonMultiplier: number;
}

async function loadRotationSettings(prisma: PrismaClient): Promise<RotationSettings> {
  const farmSettings = await prisma.farmSettings.findUnique({
    where: { id: 'singleton' },
    select: {
      defaultRestDays: true,
      defaultMaxGrazingDays: true,
      rotationSeasonMode: true,
      dormantSeasonMultiplier: true,
    },
  });

  const raw: RotationFarmSettings = farmSettings ?? {
    defaultRestDays: 60,
    defaultMaxGrazingDays: 7,
    rotationSeasonMode: 'auto',
    dormantSeasonMultiplier: 1.4,
  };

  const mode: RotationSettings['rotationSeasonMode'] =
    raw.rotationSeasonMode === 'growing' || raw.rotationSeasonMode === 'dormant'
      ? raw.rotationSeasonMode
      : 'auto';

  return {
    defaultRestDays: raw.defaultRestDays ?? 60,
    defaultMaxGrazingDays: raw.defaultMaxGrazingDays ?? 7,
    rotationSeasonMode: mode,
    dormantSeasonMultiplier: raw.dormantSeasonMultiplier ?? 1.4,
  };
}

/**
 * Computes full rotation status for every camp on the farm.
 *
 * `now` is injectable to make this testable (and to pin the reporting clock
 * for a request). Defaults to `new Date()` if omitted.
 */
export async function getRotationStatusByCamp(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<RotationPayload> {
  const [settings, camps, mobs, animals, coverReadings, moves, veldByCamp] = await Promise.all([
    loadRotationSettings(prisma),
    prisma.camp.findMany({
      select: {
        campId: true,
        campName: true,
        sizeHectares: true,
        veldType: true,
        restDaysOverride: true,
        maxGrazingDaysOverride: true,
        rotationNotes: true,
      },
    }),
    prisma.mob.findMany({ select: { id: true, name: true } }),
    prisma.animal.findMany({
      where: { status: 'Active' },
      select: {
        currentCamp: true,
        species: true,
        category: true,
        mobId: true,
      },
    }),
    prisma.campCoverReading.findMany({
      orderBy: { recordedAt: 'desc' },
      select: { campId: true, kgDmPerHa: true, useFactor: true },
    }),
    getLatestMovesByCamp(prisma),
    getLatestVeldByCamp(prisma),
  ]);

  const lsuValues = getMergedLsuValues();

  // Mutable accumulator — populated in the loop below, then converted to readonly output.
  interface MobBucket {
    readonly mobId: string | null;
    readonly species: string;
    count: number;
    readonly categories: Map<string, number>; // Map itself is mutated (entries added), not reassigned
  }
  const campToMobs = new Map<string, Map<string, MobBucket>>();

  for (const a of animals) {
    const campId = a.currentCamp ?? '';
    if (!campId) continue;
    const mobKey = a.mobId ?? `__loose_${a.species}`;
    let mobMap = campToMobs.get(campId);
    if (!mobMap) {
      mobMap = new Map();
      campToMobs.set(campId, mobMap);
    }
    let bucket = mobMap.get(mobKey);
    if (!bucket) {
      bucket = {
        mobId: a.mobId ?? null,
        species: a.species,
        count: 0,
        categories: new Map(),
      };
      mobMap.set(mobKey, bucket);
    }
    bucket.count += 1;
    bucket.categories.set(a.category, (bucket.categories.get(a.category) ?? 0) + 1);
  }

  const mobsById = new Map<string, { name: string }>();
  for (const m of mobs) mobsById.set(m.id, { name: m.name });

  // Latest cover reading per camp (first row wins since ordered desc).
  const latestCover = new Map<string, { kgDmPerHa: number; useFactor: number }>();
  for (const r of coverReadings) {
    if (!latestCover.has(r.campId)) {
      latestCover.set(r.campId, { kgDmPerHa: r.kgDmPerHa, useFactor: r.useFactor });
    }
  }

  const counts = {
    grazing: 0,
    overstayed: 0,
    resting: 0,
    restingReady: 0,
    overdueRest: 0,
    unknown: 0,
  };

  const campStatuses: CampRotationStatus[] = camps.map((camp) => {
    const veldType = isValidVeldType(camp.veldType) ? camp.veldType : null;
    const campConfig: CampRotationConfig = {
      veldType,
      restDaysOverride: camp.restDaysOverride,
      maxGrazingDaysOverride: camp.maxGrazingDaysOverride,
    };

    const veldScore = veldByCamp.get(camp.campId)?.score ?? null;
    const effectiveRestDays = resolveEffectiveRestDays(campConfig, settings, now, veldScore);
    const effectiveMaxGrazingDays = resolveEffectiveMaxGrazingDays(campConfig, settings);

    const mobMap = campToMobs.get(camp.campId);
    const currentMobs: RotationMobSummary[] = [];
    let totalAnimals = 0;
    let totalLsu = 0;

    if (mobMap) {
      for (const bucket of mobMap.values()) {
        const categoriesArr = Array.from(bucket.categories, ([category, count]) => ({
          category,
          count,
        }));
        const lsu = calcLsu(categoriesArr, lsuValues);
        totalAnimals += bucket.count;
        totalLsu += lsu;
        const mobName = bucket.mobId
          ? mobsById.get(bucket.mobId)?.name ?? `Mob ${bucket.mobId.slice(0, 6)}`
          : `${bucket.species[0]?.toUpperCase() ?? ''}${bucket.species.slice(1)} (unassigned)`;
        currentMobs.push({
          mobId: bucket.mobId,
          mobName,
          animalCount: bucket.count,
          lsu,
          species: bucket.species,
        });
      }
    }

    const isOccupied = totalAnimals > 0;
    const moveRecord = moves.get(camp.campId);
    const lastArrivedAt = moveRecord?.arrivedAt ?? null;
    const lastDepartedAt = moveRecord?.departedAt ?? null;

    let daysGrazed: number | null = null;
    let daysRested: number | null = null;
    let nextEligibleDate: string | null = null;

    if (isOccupied) {
      // Count "days in camp" from the most recent arrival. If we have no
      // arrival record (animals existed before rotation tracking), fall back
      // to creation date — conservative, better than null for classification.
      if (lastArrivedAt) {
        daysGrazed = daysBetween(lastArrivedAt, now);
      }
    } else if (lastDepartedAt) {
      daysRested = daysBetween(lastDepartedAt, now);
      nextEligibleDate = new Date(
        lastDepartedAt.getTime() + effectiveRestDays * 24 * 60 * 60 * 1000,
      ).toISOString();
    }

    const status = classifyCampStatus({
      isOccupied,
      daysGrazed,
      daysRested,
      effectiveMaxGrazingDays,
      effectiveRestDays,
    });

    switch (status) {
      case 'grazing':
        counts.grazing += 1;
        break;
      case 'overstayed':
        counts.overstayed += 1;
        break;
      case 'resting':
        counts.resting += 1;
        break;
      case 'resting_ready':
        counts.restingReady += 1;
        break;
      case 'overdue_rest':
        counts.overdueRest += 1;
        break;
      case 'unknown':
        counts.unknown += 1;
        break;
    }

    const cover = latestCover.get(camp.campId);
    const capacityLsuDays = calcCampLsuDays(
      cover?.kgDmPerHa ?? null,
      cover?.useFactor ?? null,
      camp.sizeHectares,
    );

    return {
      campId: camp.campId,
      campName: camp.campName,
      sizeHectares: camp.sizeHectares,
      veldType,
      rotationNotes: camp.rotationNotes,
      status,
      currentMobs,
      totalAnimals,
      totalLsu,
      daysGrazed,
      daysRested,
      lastDepartedAt: lastDepartedAt?.toISOString() ?? null,
      lastArrivedAt: lastArrivedAt?.toISOString() ?? null,
      effectiveRestDays,
      effectiveMaxGrazingDays,
      restDaysOverride: camp.restDaysOverride,
      maxGrazingDaysOverride: camp.maxGrazingDaysOverride,
      nextEligibleDate,
      capacityLsuDays,
      veldScoreAtStatus: veldScore,
    };
  });

  const rankable = campStatuses.map((c) => ({
    campId: c.campId,
    status: c.status,
    daysRested: c.daysRested,
    capacityLsuDays: c.capacityLsuDays,
  }));
  const nextToGrazeRanked = rankNextToGraze(rankable);
  const nextToGraze = nextToGrazeRanked.map((r) => ({
    campId: r.campId,
    daysRested: r.daysRested,
  }));

  const seasonMultiplier = resolveSeasonalMultiplier(settings, now);

  return {
    now: now.toISOString(),
    settings: {
      defaultRestDays: settings.defaultRestDays,
      defaultMaxGrazingDays: settings.defaultMaxGrazingDays,
      rotationSeasonMode: settings.rotationSeasonMode,
      dormantSeasonMultiplier: settings.dormantSeasonMultiplier,
      seasonMultiplierInEffect: seasonMultiplier,
      isDormantSeason: seasonMultiplier > 1,
    },
    camps: campStatuses,
    nextToGraze,
    counts,
  };
}
