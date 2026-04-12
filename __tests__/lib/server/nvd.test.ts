/**
 * __tests__/lib/server/nvd.test.ts
 *
 * Tests for the NVD server module.
 * Uses mock Prisma clients — no real DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal mock for the Prisma transaction callback used in issueNvd.
 * Proxies all calls to the same mock.
 */
function makeMockPrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    nvdRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    observation: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    animal: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    farmSettings: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(overrides.__txClient ?? {})),
    ...overrides,
  } as unknown as PrismaClient;
}

// ── generateNvdNumber ─────────────────────────────────────────────────────────

describe('generateNvdNumber', () => {
  it('formats number as NVD-YYYY-NNNN', async () => {
    const { generateNvdNumber } = await import('@/lib/server/nvd');

    const txClient = {
      nvdRecord: {
        findFirst: vi.fn().mockResolvedValue(null), // no existing records
        create: vi.fn().mockImplementation(async ({ data }: { data: { nvdNumber: string } }) => ({ nvdNumber: data.nvdNumber })),
      },
    } as unknown as PrismaClient;

    const number = await generateNvdNumber(txClient, 2026);
    expect(number).toBe('NVD-2026-0001');
  });

  it('increments from the highest existing number', async () => {
    const { generateNvdNumber } = await import('@/lib/server/nvd');

    const txClient = {
      nvdRecord: {
        findFirst: vi.fn().mockResolvedValue({ nvdNumber: 'NVD-2026-0042' }),
        create: vi.fn().mockImplementation(async ({ data }: { data: { nvdNumber: string } }) => ({ nvdNumber: data.nvdNumber })),
      },
    } as unknown as PrismaClient;

    const number = await generateNvdNumber(txClient, 2026);
    expect(number).toBe('NVD-2026-0043');
  });

  it('resets counter for a new year', async () => {
    const { generateNvdNumber } = await import('@/lib/server/nvd');

    const txClient = {
      nvdRecord: {
        findFirst: vi.fn().mockResolvedValue(null), // no 2027 records
        create: vi.fn().mockImplementation(async ({ data }: { data: { nvdNumber: string } }) => ({ nvdNumber: data.nvdNumber })),
      },
    } as unknown as PrismaClient;

    const number = await generateNvdNumber(txClient, 2027);
    expect(number).toBe('NVD-2027-0001');
  });
});

// ── validateNvdAnimals ────────────────────────────────────────────────────────

describe('validateNvdAnimals', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns ok:true when no animals are in withdrawal', async () => {
    // Mock getAnimalsInWithdrawal to return empty
    vi.doMock('@/lib/server/treatment-analytics', () => ({
      getAnimalsInWithdrawal: vi.fn().mockResolvedValue([]),
    }));

    const { validateNvdAnimals } = await import('@/lib/server/nvd');
    const prisma = makeMockPrisma();

    const result = await validateNvdAnimals(prisma, ['A001', 'A002']);
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with blockers when selected animals are in withdrawal', async () => {
    const blockerAnimal = {
      animalId: 'A002',
      name: 'Bessie',
      campId: 'C1',
      treatmentType: 'Antibiotic',
      treatedAt: new Date('2026-04-01'),
      withdrawalDays: 14,
      withdrawalEndsAt: new Date('2026-04-15'),
      daysRemaining: 4,
    };

    vi.doMock('@/lib/server/treatment-analytics', () => ({
      getAnimalsInWithdrawal: vi.fn().mockResolvedValue([blockerAnimal]),
    }));

    const { validateNvdAnimals } = await import('@/lib/server/nvd');
    const prisma = makeMockPrisma();

    const result = await validateNvdAnimals(prisma, ['A001', 'A002']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].animalId).toBe('A002');
    }
  });

  it('ignores withdrawal animals not in the selected list', async () => {
    const otherAnimal = {
      animalId: 'A999', // not in the selected list
      name: 'Other',
      campId: 'C1',
      treatmentType: 'Antibiotic',
      treatedAt: new Date('2026-04-01'),
      withdrawalDays: 14,
      withdrawalEndsAt: new Date('2026-04-15'),
      daysRemaining: 4,
    };

    vi.doMock('@/lib/server/treatment-analytics', () => ({
      getAnimalsInWithdrawal: vi.fn().mockResolvedValue([otherAnimal]),
    }));

    const { validateNvdAnimals } = await import('@/lib/server/nvd');
    const prisma = makeMockPrisma();

    const result = await validateNvdAnimals(prisma, ['A001', 'A002']);
    expect(result.ok).toBe(true);
  });
});

// ── buildSellerSnapshot ───────────────────────────────────────────────────────

describe('buildSellerSnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns all seller identity fields from FarmSettings', async () => {
    const { buildSellerSnapshot } = await import('@/lib/server/nvd');

    const prisma = makeMockPrisma({
      farmSettings: {
        findFirst: vi.fn().mockResolvedValue({
          farmName: 'Doornhoek',
          ownerName: 'Jan van Niekerk',
          ownerIdNumber: '8001015009087',
          physicalAddress: 'Plaas Doornhoek, Vaalwater',
          postalAddress: 'P.O. Box 1',
          contactPhone: '082 555 1234',
          contactEmail: 'jan@doornhoek.co.za',
          propertyRegNumber: 'LP-2024-001',
          farmRegion: 'Limpopo',
        }),
      },
    });

    const snapshot = await buildSellerSnapshot(prisma);
    expect(snapshot.ownerName).toBe('Jan van Niekerk');
    expect(snapshot.farmName).toBe('Doornhoek');
    expect(snapshot.propertyRegNumber).toBe('LP-2024-001');
  });

  it('returns empty strings for missing fields rather than null', async () => {
    const { buildSellerSnapshot } = await import('@/lib/server/nvd');

    const prisma = makeMockPrisma({
      farmSettings: {
        findFirst: vi.fn().mockResolvedValue({
          farmName: 'My Farm',
          ownerName: null,
          ownerIdNumber: null,
          physicalAddress: null,
          postalAddress: null,
          contactPhone: null,
          contactEmail: null,
          propertyRegNumber: null,
          farmRegion: null,
        }),
      },
    });

    const snapshot = await buildSellerSnapshot(prisma);
    expect(snapshot.ownerName).toBe('');
    expect(snapshot.physicalAddress).toBe('');
  });
});

// ── buildAnimalSnapshot ───────────────────────────────────────────────────────

describe('buildAnimalSnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns snapshot entries for each requested animal', async () => {
    const { buildAnimalSnapshot } = await import('@/lib/server/nvd');

    const prisma = makeMockPrisma({
      animal: {
        findMany: vi.fn().mockResolvedValue([
          {
            animalId: 'A001',
            name: 'Bessie',
            sex: 'F',
            breed: 'Brangus',
            category: 'Cow',
            dateOfBirth: '2020-01-15',
            currentCamp: 'C1',
            status: 'Active',
          },
        ]),
      },
      observation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    const snapshots = await buildAnimalSnapshot(prisma, ['A001']);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].animalId).toBe('A001');
    expect(snapshots[0].lastCampId).toBe('C1');
  });

  it('snapshot is deterministic — same input produces identical output', async () => {
    const { buildAnimalSnapshot } = await import('@/lib/server/nvd');

    const animals = [
      { animalId: 'A001', name: null, sex: 'M', breed: 'Brangus', category: 'Bull', dateOfBirth: '2019-06-01', currentCamp: 'C2', status: 'Active' },
    ];

    const prisma = makeMockPrisma({
      animal: { findMany: vi.fn().mockResolvedValue(animals) },
      observation: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const first = await buildAnimalSnapshot(prisma, ['A001']);
    const second = await buildAnimalSnapshot(prisma, ['A001']);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
