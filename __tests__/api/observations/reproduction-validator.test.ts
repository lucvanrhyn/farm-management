/**
 * @vitest-environment node
 *
 * __tests__/api/observations/reproduction-validator.test.ts
 *
 * Wave 1 / #253 — closes the silent data-loss path identified in the
 * 2026-05-13 stress test:
 *
 *   The Repro form let users toggle In Heat + Pregnant + Open simultaneously
 *   (mutually exclusive states). The dirty payload was silently collapsed
 *   server-side: only In Heat persisted, the rest were dropped.
 *
 * The defense-in-depth fix:
 *   1. UI radio (covered by `__tests__/components/repro-form-radio.test.tsx`).
 *   2. Server Zod refinement on POST /api/observations that REJECTS any
 *      payload claiming more than one mutually-exclusive reproductive state
 *      with `422 { error: "REPRO_MULTI_STATE" }`, and rejects an empty
 *      reproductive payload with `422 { error: "REPRO_REQUIRED" }`.
 *
 * The validator is gated on `body.type` so it ONLY fires for reproductive
 * observations (`heat_detection`, `pregnancy_scan`). Death (`type=death`),
 * weighing, treatment, etc. are unaffected — that's what keeps Wave 2
 * (Death single-cause radio) and this wave from colliding on the same
 * shared route file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  validateReproductiveState,
  ReproMultiStateError,
  ReproRequiredError,
} from '@/lib/server/validators/reproductive-state';

// vi.mock factories hoist above top-level const declarations (per
// memory/feedback-vi-hoisted-shared-mocks.md), so any state the factories
// need must come from vi.hoisted().
const { campFindFirstMock, observationCreateMock, observationUpsertMock, prismaMock } =
  vi.hoisted(() => {
    const campFindFirst = vi.fn();
    const observationCreate = vi.fn();
    const observationUpsert = vi.fn();
    const prisma = {
      camp: { findFirst: campFindFirst },
      animal: { findUnique: vi.fn().mockResolvedValue({ species: 'cattle' }) },
      observation: { create: observationCreate, upsert: observationUpsert },
    };
    return {
      campFindFirstMock: campFindFirst,
      observationCreateMock: observationCreate,
      observationUpsertMock: observationUpsert,
      prismaMock: prisma,
    };
  });

vi.mock('@/lib/server/farm-context', () => ({
  getFarmContext: vi.fn().mockResolvedValue({
    prisma: prismaMock,
    role: 'LOGGER',
    slug: 'test-farm',
    session: { user: { id: 'user-1', email: 'logger@farm.co.za' } },
  }),
}));

vi.mock('@/lib/server/revalidate', () => ({
  revalidateObservationWrite: vi.fn(),
}));

describe('validateReproductiveState — single-state pass', () => {
  it('passes for a heat_detection observation with method-only details', () => {
    expect(() =>
      validateReproductiveState('heat_detection', { method: 'visual' }),
    ).not.toThrow();
  });

  it('passes for a pregnancy_scan observation with result=pregnant', () => {
    expect(() =>
      validateReproductiveState('pregnancy_scan', { result: 'pregnant' }),
    ).not.toThrow();
  });

  it('passes for a pregnancy_scan observation with result=empty (Open)', () => {
    expect(() =>
      validateReproductiveState('pregnancy_scan', { result: 'empty' }),
    ).not.toThrow();
  });

  it('passes for a pregnancy_scan observation with result=uncertain', () => {
    expect(() =>
      validateReproductiveState('pregnancy_scan', { result: 'uncertain' }),
    ).not.toThrow();
  });

  it('accepts a JSON-string details payload (logger queues stringify before POST)', () => {
    expect(() =>
      validateReproductiveState('pregnancy_scan', JSON.stringify({ result: 'pregnant' })),
    ).not.toThrow();
  });

  it('is a no-op for non-reproductive observation types', () => {
    // Defends against accidental scope creep into death / weighing / treatment.
    // Wave 2 (Death single-cause radio) owns its own validator on the same route.
    expect(() => validateReproductiveState('death', {})).not.toThrow();
    expect(() => validateReproductiveState('weighing', { weight_kg: '450' })).not.toThrow();
    expect(() => validateReproductiveState('treatment', {})).not.toThrow();
    expect(() => validateReproductiveState('camp_condition', {})).not.toThrow();
  });
});

describe('validateReproductiveState — multi-state rejection (REPRO_MULTI_STATE)', () => {
  it('throws ReproMultiStateError when in_heat + pregnant flags are both set', () => {
    expect(() =>
      validateReproductiveState('heat_detection', {
        in_heat: true,
        pregnant: true,
      }),
    ).toThrow(ReproMultiStateError);
  });

  it('throws ReproMultiStateError when in_heat + open flags are both set', () => {
    expect(() =>
      validateReproductiveState('heat_detection', {
        in_heat: true,
        open: true,
      }),
    ).toThrow(ReproMultiStateError);
  });

  it('throws ReproMultiStateError when pregnant + open flags are both set', () => {
    expect(() =>
      validateReproductiveState('pregnancy_scan', {
        pregnant: true,
        open: true,
      }),
    ).toThrow(ReproMultiStateError);
  });

  it('throws ReproMultiStateError when all three state flags are set', () => {
    expect(() =>
      validateReproductiveState('heat_detection', {
        in_heat: true,
        pregnant: true,
        open: true,
      }),
    ).toThrow(ReproMultiStateError);
  });

  it('rejects boolean-as-string flags ("true") — common offline-sync drift', () => {
    expect(() =>
      validateReproductiveState('heat_detection', {
        in_heat: 'true',
        pregnant: 'true',
      }),
    ).toThrow(ReproMultiStateError);
  });

  it('error carries the canonical 422 wire code', () => {
    try {
      validateReproductiveState('heat_detection', {
        in_heat: true,
        pregnant: true,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReproMultiStateError);
      expect((err as ReproMultiStateError).code).toBe('REPRO_MULTI_STATE');
    }
  });
});

describe('validateReproductiveState — empty rejection (REPRO_REQUIRED)', () => {
  it('throws ReproRequiredError on a heat_detection with empty details {}', () => {
    expect(() => validateReproductiveState('heat_detection', {})).toThrow(
      ReproRequiredError,
    );
  });

  it('throws ReproRequiredError on a pregnancy_scan with no result field', () => {
    expect(() => validateReproductiveState('pregnancy_scan', {})).toThrow(
      ReproRequiredError,
    );
  });

  it('throws ReproRequiredError when details is null', () => {
    expect(() => validateReproductiveState('heat_detection', null)).toThrow(
      ReproRequiredError,
    );
  });

  it('throws ReproRequiredError when details is the empty string', () => {
    expect(() => validateReproductiveState('heat_detection', '')).toThrow(
      ReproRequiredError,
    );
  });

  it('throws ReproRequiredError on malformed JSON details (logger never sends this — defend anyway)', () => {
    expect(() =>
      validateReproductiveState('heat_detection', '{not json'),
    ).toThrow(ReproRequiredError);
  });

  it('error carries the canonical 422 wire code', () => {
    try {
      validateReproductiveState('pregnancy_scan', {});
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReproRequiredError);
      expect((err as ReproRequiredError).code).toBe('REPRO_REQUIRED');
    }
  });
});

// ── Route-level integration ────────────────────────────────────────────────
//
// The unit suite above proves the validator's contract; this suite proves the
// POST /api/observations route actually invokes it and emits a 422 envelope
// for the bug class the wave was dispatched to close.
function postObservationReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/observations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/observations — reproductive state envelope', () => {
  beforeEach(() => {
    campFindFirstMock.mockReset();
    observationCreateMock.mockReset();
    observationUpsertMock.mockReset();
    // Default: camp exists for the happy path.
    campFindFirstMock.mockResolvedValue({ campId: 'CAMP-1' });
    observationCreateMock.mockResolvedValue({ id: 'obs-1' });
    observationUpsertMock.mockResolvedValue({ id: 'obs-1' });
  });

  it('returns 422 REPRO_MULTI_STATE for a payload with both pregnant and open flags', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'pregnancy_scan',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({ pregnant: true, open: true }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('REPRO_MULTI_STATE');
    expect(observationCreateMock).not.toHaveBeenCalled();
    expect(observationUpsertMock).not.toHaveBeenCalled();
  });

  it('returns 422 REPRO_REQUIRED for an empty pregnancy_scan payload', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'pregnancy_scan',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({}),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('REPRO_REQUIRED');
    expect(observationCreateMock).not.toHaveBeenCalled();
    expect(observationUpsertMock).not.toHaveBeenCalled();
  });

  it('lets a clean single-state pregnancy_scan through (200)', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'pregnancy_scan',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({ result: 'pregnant' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, id: 'obs-1' });
  });

  it('does NOT block a clean death observation (scope-discipline guarantee)', async () => {
    // Smoke test for the scope-discipline guarantee: the reproductive
    // validator must remain a no-op for Death observations. Wave 3b /
    // #254 added its own death validator on the same route — to keep this
    // test orthogonal we send a payload that satisfies BOTH validators
    // (cause: 'Old age' + carcassDisposal: 'OTHER').
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'death',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({ cause: 'Old age', carcassDisposal: 'OTHER' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(observationCreateMock).toHaveBeenCalled();
  });
});
