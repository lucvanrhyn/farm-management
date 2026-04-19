/**
 * __tests__/alerts/fixtures.ts — shared alert-test helpers.
 *
 * Every generator accepts (prisma, settings, slug). We don't want to build a
 * real Prisma shape per file, so this fixture yields a MockPrisma object that
 * exposes every model method used anywhere in lib/server/alerts/*. Tests pass
 * overrides for the handful of methods they care about.
 */

import { vi } from "vitest";
import type { FarmSettings, PrismaClient } from "@prisma/client";

export function makeSettings(overrides: Partial<FarmSettings> = {}): FarmSettings {
  // Shape-compat stub. We only care about the fields the generators read.
  return {
    id: "singleton",
    alertThresholdHours: 48,
    farmName: "Test Farm",
    breed: "Mixed",
    updatedAt: new Date(),
    updatedBy: null,
    adgPoorDoerThreshold: 0.7,
    calvingAlertDays: 14,
    daysOpenLimit: 365,
    campGrazingWarningDays: 7,
    defaultRestDays: 60,
    defaultMaxGrazingDays: 7,
    rotationSeasonMode: "auto",
    dormantSeasonMultiplier: 1.4,
    latitude: null,
    longitude: null,
    targetStockingRate: null,
    breedingSeasonStart: null,
    breedingSeasonEnd: null,
    weaningDate: null,
    openaiApiKey: null,
    heroImageUrl: "/farm-hero.jpg",
    ownerName: null,
    ownerIdNumber: null,
    physicalAddress: null,
    postalAddress: null,
    contactPhone: null,
    contactEmail: null,
    propertyRegNumber: null,
    farmRegion: null,
    biomeType: null,
    onboardingComplete: true,
    quietHoursStart: "20:00",
    quietHoursEnd: "06:00",
    timezone: "Africa/Johannesburg",
    speciesAlertThresholds: null,
    ...overrides,
  } as unknown as FarmSettings;
}

type FnOrFns = ReturnType<typeof vi.fn> | Record<string, ReturnType<typeof vi.fn>>;

export function makePrisma(
  overrides: Record<string, FnOrFns> = {},
): PrismaClient {
  const noop = vi.fn().mockResolvedValue([]);
  const noopFirst = vi.fn().mockResolvedValue(null);
  const base = {
    animal: { findMany: vi.fn().mockResolvedValue([]) },
    observation: { findMany: vi.fn().mockResolvedValue([]) },
    camp: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    farmSettings: { findFirst: noopFirst, findUnique: noopFirst },
    notification: {
      findFirst: noopFirst,
      findMany: noop,
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, id: `n-${Math.random().toString(36).slice(2, 8)}` }),
      ),
      update: vi.fn().mockImplementation(({ data, where }: { data: Record<string, unknown>; where: { id: string } }) =>
        Promise.resolve({ ...data, id: where.id }),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    rainfallRecord: { findFirst: noopFirst },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    gameSpecies: { findMany: vi.fn().mockResolvedValue([]) },
    gameWaterPoint: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findFirst: noopFirst },
    pushSubscription: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  };
  const anyBase = base as unknown as Record<string, unknown>;
  for (const [model, methods] of Object.entries(overrides)) {
    // $queryRawUnsafe is a top-level function, not an object of methods. Tests
    // can pass either a bare vi.fn() (for $queryRawUnsafe / other $* helpers)
    // or a method map (for normal models).
    if (typeof methods === "function") {
      anyBase[model] = methods;
    } else {
      const target = (anyBase[model] as Record<string, unknown>) ?? {};
      Object.assign(target, methods);
      anyBase[model] = target;
    }
  }
  return base as unknown as PrismaClient;
}

export function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

export function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}
