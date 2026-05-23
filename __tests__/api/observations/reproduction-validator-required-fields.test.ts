/**
 * @vitest-environment node
 *
 * __tests__/api/observations/reproduction-validator-required-fields.test.ts
 *
 * Wave 285/286 (PRD #279) — extends `validateReproductiveState` to enforce
 * per-type required fields for the reproduction sub-flows that previously
 * had NO server-side gate:
 *
 *   - body_condition_score → `score` ∈ [1..9]
 *   - temperament_score    → `score` ∈ [1..5]
 *   - insemination         → `method` ∈ {AI, natural}
 *   - calving              → calf identity (`calf_tag` | `calfAnimalId`)
 *
 * Root cause (#286): `ReproductionForm.tsx` pre-filled `useState` defaults
 * (bcsScore=5, temperamentScore=1, insemMethod="AI", heatMethod="visual",
 * scanResult="pregnant") that read as the farmer's answer, and every submit
 * was ungated. `REPRO_TYPES` was only {heat_detection, pregnancy_scan}, so
 * the validator was a no-op for these types — a stale / offline-queued
 * client could persist a fabricated default.
 *
 * Root cause (#285): `CalvingForm.tsx` enforced the required calf tag only
 * via an `alert()`; a bad record still enqueued offline / from a stale
 * client because the server never checked.
 *
 * Follows the death-observation validation precedent
 * (`lib/server/validators/death.ts`): typed errors mapped to a 422 envelope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  validateReproductiveState,
  ReproFieldRequiredError,
} from '@/lib/server/validators/reproductive-state';

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

// ── body_condition_score ───────────────────────────────────────────────────
describe('validateReproductiveState — body_condition_score', () => {
  it('passes for a valid score in range (1..9)', () => {
    expect(() =>
      validateReproductiveState('body_condition_score', { score: '5' }),
    ).not.toThrow();
    expect(() =>
      validateReproductiveState('body_condition_score', { score: 1 }),
    ).not.toThrow();
    expect(() =>
      validateReproductiveState('body_condition_score', { score: 9 }),
    ).not.toThrow();
  });

  it('throws ReproFieldRequiredError when score is missing', () => {
    expect(() =>
      validateReproductiveState('body_condition_score', {}),
    ).toThrow(ReproFieldRequiredError);
  });

  it('throws ReproFieldRequiredError when score is out of range', () => {
    expect(() =>
      validateReproductiveState('body_condition_score', { score: '0' }),
    ).toThrow(ReproFieldRequiredError);
    expect(() =>
      validateReproductiveState('body_condition_score', { score: '10' }),
    ).toThrow(ReproFieldRequiredError);
  });

  it('throws ReproFieldRequiredError when score is non-numeric', () => {
    expect(() =>
      validateReproductiveState('body_condition_score', { score: 'good' }),
    ).toThrow(ReproFieldRequiredError);
  });

  it('error carries the canonical 422 wire code', () => {
    try {
      validateReproductiveState('body_condition_score', {});
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReproFieldRequiredError);
      expect((err as ReproFieldRequiredError).code).toBe('REPRO_FIELD_REQUIRED');
    }
  });
});

// ── temperament_score ──────────────────────────────────────────────────────
describe('validateReproductiveState — temperament_score', () => {
  it('passes for a valid score in range (1..5)', () => {
    expect(() =>
      validateReproductiveState('temperament_score', { score: '1' }),
    ).not.toThrow();
    expect(() =>
      validateReproductiveState('temperament_score', { score: 5 }),
    ).not.toThrow();
  });

  it('throws ReproFieldRequiredError when score is missing', () => {
    expect(() =>
      validateReproductiveState('temperament_score', {}),
    ).toThrow(ReproFieldRequiredError);
  });

  it('throws ReproFieldRequiredError when score is out of range (6)', () => {
    expect(() =>
      validateReproductiveState('temperament_score', { score: '6' }),
    ).toThrow(ReproFieldRequiredError);
  });
});

// ── insemination ───────────────────────────────────────────────────────────
describe('validateReproductiveState — insemination', () => {
  it('passes for method=AI', () => {
    expect(() =>
      validateReproductiveState('insemination', { method: 'AI' }),
    ).not.toThrow();
  });

  it('passes for method=natural', () => {
    expect(() =>
      validateReproductiveState('insemination', { method: 'natural' }),
    ).not.toThrow();
  });

  it('throws ReproFieldRequiredError when method is missing', () => {
    expect(() =>
      validateReproductiveState('insemination', {}),
    ).toThrow(ReproFieldRequiredError);
  });

  it('throws ReproFieldRequiredError when method is not a recognised value', () => {
    expect(() =>
      validateReproductiveState('insemination', { method: 'guess' }),
    ).toThrow(ReproFieldRequiredError);
  });
});

// ── calving (#285) ─────────────────────────────────────────────────────────
describe('validateReproductiveState — calving requires calf identity (#285)', () => {
  it('passes when calf_tag is present', () => {
    expect(() =>
      validateReproductiveState('calving', { calf_tag: 'CALF-2026-001' }),
    ).not.toThrow();
  });

  it('passes when calfAnimalId is present (CalvingForm wire field)', () => {
    expect(() =>
      validateReproductiveState('calving', { calfAnimalId: 'T-2024-001' }),
    ).not.toThrow();
  });

  it('throws ReproFieldRequiredError when no calf identity is present', () => {
    expect(() =>
      validateReproductiveState('calving', { calf_status: 'live' }),
    ).toThrow(ReproFieldRequiredError);
  });

  it('throws ReproFieldRequiredError when calf_tag is blank/whitespace', () => {
    expect(() =>
      validateReproductiveState('calving', { calf_tag: '   ' }),
    ).toThrow(ReproFieldRequiredError);
  });

  it('throws ReproFieldRequiredError when details is null (offline stale client)', () => {
    expect(() => validateReproductiveState('calving', null)).toThrow(
      ReproFieldRequiredError,
    );
  });
});

// ── scope discipline — existing types still behave ─────────────────────────
describe('validateReproductiveState — existing types unaffected', () => {
  it('still no-ops for death / weighing / treatment', () => {
    expect(() => validateReproductiveState('death', {})).not.toThrow();
    expect(() =>
      validateReproductiveState('weighing', { weight_kg: '450' }),
    ).not.toThrow();
  });

  it('still passes a clean heat_detection', () => {
    expect(() =>
      validateReproductiveState('heat_detection', { method: 'visual' }),
    ).not.toThrow();
  });
});

// ── Route-level integration ────────────────────────────────────────────────
function postObservationReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/observations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/observations — extended repro required-field envelope', () => {
  beforeEach(() => {
    campFindFirstMock.mockReset();
    observationCreateMock.mockReset();
    observationUpsertMock.mockReset();
    campFindFirstMock.mockResolvedValue({ campId: 'CAMP-1' });
    observationCreateMock.mockResolvedValue({ id: 'obs-1' });
    observationUpsertMock.mockResolvedValue({ id: 'obs-1' });
  });

  it('returns 422 REPRO_FIELD_REQUIRED for a calving POST missing calf identity', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'calving',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({ calf_status: 'live' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('REPRO_FIELD_REQUIRED');
    expect(observationCreateMock).not.toHaveBeenCalled();
    expect(observationUpsertMock).not.toHaveBeenCalled();
  });

  it('returns 422 REPRO_FIELD_REQUIRED for a body_condition_score POST with no score', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'body_condition_score',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({}),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('REPRO_FIELD_REQUIRED');
    expect(observationCreateMock).not.toHaveBeenCalled();
  });

  it('lets a clean calving observation through (200)', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'calving',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({ calf_tag: 'CALF-2026-001', calf_status: 'live' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(observationCreateMock).toHaveBeenCalled();
  });

  it('does NOT reject a clean body_condition_score with REPRO_FIELD_REQUIRED', async () => {
    // NB: `body_condition_score` is not in `VALID_OBSERVATION_TYPES`
    // (lib/domain/observations/create-observation.ts — outside this wave's
    // allow-list), so a clean payload still 422s downstream with
    // INVALID_TYPE. The contract this wave owns is narrower: the
    // reproductive validator must NOT be the thing that rejects a payload
    // that supplies the required `score`. The unit suite above proves the
    // validator's pass path directly.
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'body_condition_score',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({ score: '6' }),
      }),
      { params: Promise.resolve({}) },
    );

    if (res.status === 422) {
      const json = await res.json();
      expect(json.error).not.toBe('REPRO_FIELD_REQUIRED');
    }
  });
});
