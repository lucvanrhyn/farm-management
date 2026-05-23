/**
 * @vitest-environment node
 *
 * __tests__/api/observations/death-validator.test.ts
 *
 * Wave 3b / #254 (PRD #250) — Death single-cause + required carcassDisposal.
 *
 * Bug class — same shape as #253 (reproductive-state):
 *   The Death modal historically let the user assert multiple mutually-
 *   exclusive causes (Disease + Predator + Other) AND submitted the row
 *   without any disposal decision. The dirty payload was silently
 *   collapsed; carcass-disposal data — required for SARS / NSPCA reporting
 *   — was never captured.
 *
 * Defense-in-depth fix:
 *   1. UI: a single radio for cause + a required <Select /> for disposal
 *      (covered by `__tests__/components/death-form-radio.test.tsx` and
 *      e2e/death-disposal.spec.ts).
 *   2. Server: this validator. Even a stale or malicious client cannot
 *      bypass the rule — the POST /api/observations route invokes
 *      `validateDeathObservation` and rejects with:
 *        - `422 { error: "DEATH_MULTI_CAUSE" }` if >1 cause asserted.
 *        - `422 { error: "DEATH_DISPOSAL_REQUIRED" }` if `carcassDisposal`
 *          is missing or not in the canonical enum.
 *
 * Scope discipline (mirrors the reproductive validator):
 *   The shared `app/api/observations/route.ts` POST is wired across every
 *   observation type. To keep waves from colliding, this validator is a
 *   *no-op* for any `type` that is not `death`. Reproduction, weighing,
 *   treatment etc. flow through unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  validateDeathObservation,
  DeathMultiCauseError,
  DeathDisposalRequiredError,
  CARCASS_DISPOSAL_VALUES,
} from '@/lib/server/validators/death';

// vi.mock factories hoist above top-level const declarations
// (memory/feedback-vi-hoisted-shared-mocks.md), so any state the factories
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

describe('CARCASS_DISPOSAL_VALUES — locked enum (HITL #254)', () => {
  it('exports the four maintainer-locked values verbatim', () => {
    // The enum is regulatory-safe per SARS / NSPCA conventions. Adding or
    // renaming a value MUST be a separate HITL decision — locking the test
    // here means a drift PR fails CI.
    expect(CARCASS_DISPOSAL_VALUES).toEqual(['BURIED', 'BURNED', 'RENDERED', 'OTHER']);
  });
});

describe('validateDeathObservation — single-cause + valid disposal pass', () => {
  it.each(['Disease', 'Predator', 'Accident', 'Old age', 'Stillbirth', 'Other'])(
    'passes for cause=%s + carcassDisposal=BURIED',
    (cause) => {
      expect(() =>
        validateDeathObservation({ cause, carcassDisposal: 'BURIED' }),
      ).not.toThrow();
    },
  );

  it.each(['BURIED', 'BURNED', 'RENDERED', 'OTHER'])(
    'passes for valid disposal=%s',
    (disposal) => {
      expect(() =>
        validateDeathObservation({ cause: 'Old age', carcassDisposal: disposal }),
      ).not.toThrow();
    },
  );

  it('accepts a JSON-string details payload (logger queues stringify before POST)', () => {
    expect(() =>
      validateDeathObservation(
        JSON.stringify({ cause: 'Disease', carcassDisposal: 'BURIED' }),
      ),
    ).not.toThrow();
  });
});

describe('validateDeathObservation — multi-cause rejection (DEATH_MULTI_CAUSE)', () => {
  it('throws DeathMultiCauseError when an array of causes is submitted', () => {
    expect(() =>
      validateDeathObservation({
        cause: ['Disease', 'Predator'],
        carcassDisposal: 'BURIED',
      } as unknown as Record<string, unknown>),
    ).toThrow(DeathMultiCauseError);
  });

  it('throws DeathMultiCauseError when both `cause` and `causes` are populated', () => {
    expect(() =>
      validateDeathObservation({
        cause: 'Disease',
        causes: ['Predator', 'Accident'],
        carcassDisposal: 'BURIED',
      } as unknown as Record<string, unknown>),
    ).toThrow(DeathMultiCauseError);
  });

  it('throws DeathMultiCauseError when `causes` array has length > 1', () => {
    expect(() =>
      validateDeathObservation({
        causes: ['Disease', 'Other'],
        carcassDisposal: 'BURIED',
      } as unknown as Record<string, unknown>),
    ).toThrow(DeathMultiCauseError);
  });

  it('error carries the canonical 422 wire code', () => {
    try {
      validateDeathObservation({
        cause: ['Disease', 'Predator'],
        carcassDisposal: 'BURIED',
      } as unknown as Record<string, unknown>);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DeathMultiCauseError);
      expect((err as DeathMultiCauseError).code).toBe('DEATH_MULTI_CAUSE');
    }
  });

  it('a single-element `causes` array is accepted (collapses to one cause)', () => {
    // Defensive: a stale client may still submit `causes: ['Disease']`. As
    // long as exactly one cause is asserted, we let it through — the
    // multi-cause class is what we're locking out.
    expect(() =>
      validateDeathObservation({
        causes: ['Disease'],
        carcassDisposal: 'BURIED',
      } as unknown as Record<string, unknown>),
    ).not.toThrow();
  });
});

describe('validateDeathObservation — disposal-required rejection (DEATH_DISPOSAL_REQUIRED)', () => {
  it('throws DeathDisposalRequiredError when carcassDisposal is missing', () => {
    expect(() =>
      validateDeathObservation({ cause: 'Old age' }),
    ).toThrow(DeathDisposalRequiredError);
  });

  it('throws DeathDisposalRequiredError when carcassDisposal is empty string', () => {
    expect(() =>
      validateDeathObservation({ cause: 'Old age', carcassDisposal: '' }),
    ).toThrow(DeathDisposalRequiredError);
  });

  it('throws DeathDisposalRequiredError when carcassDisposal is null', () => {
    expect(() =>
      validateDeathObservation({ cause: 'Old age', carcassDisposal: null }),
    ).toThrow(DeathDisposalRequiredError);
  });

  it('throws DeathDisposalRequiredError when carcassDisposal is not in the enum', () => {
    expect(() =>
      validateDeathObservation({ cause: 'Old age', carcassDisposal: 'COMPOSTED' }),
    ).toThrow(DeathDisposalRequiredError);
  });

  it('throws DeathDisposalRequiredError when details is null', () => {
    expect(() => validateDeathObservation(null)).toThrow(DeathDisposalRequiredError);
  });

  it('throws DeathDisposalRequiredError on malformed JSON details', () => {
    // Logger never sends this — defend anyway. Malformed JSON is treated as
    // an empty payload, which has no disposal, so the disposal-required
    // path catches it.
    expect(() => validateDeathObservation('{not json')).toThrow(
      DeathDisposalRequiredError,
    );
  });

  it('error carries the canonical 422 wire code', () => {
    try {
      validateDeathObservation({ cause: 'Old age' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DeathDisposalRequiredError);
      expect((err as DeathDisposalRequiredError).code).toBe('DEATH_DISPOSAL_REQUIRED');
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

describe('POST /api/observations — death envelope', () => {
  beforeEach(() => {
    campFindFirstMock.mockReset();
    observationCreateMock.mockReset();
    observationUpsertMock.mockReset();
    campFindFirstMock.mockResolvedValue({ campId: 'CAMP-1' });
    observationCreateMock.mockResolvedValue({ id: 'obs-1' });
    observationUpsertMock.mockResolvedValue({ id: 'obs-1' });
  });

  it('returns 422 DEATH_MULTI_CAUSE for a payload asserting multiple causes', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'death',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({
          causes: ['Disease', 'Predator'],
          carcassDisposal: 'BURIED',
        }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('DEATH_MULTI_CAUSE');
    expect(observationCreateMock).not.toHaveBeenCalled();
    expect(observationUpsertMock).not.toHaveBeenCalled();
  });

  it('returns 422 DEATH_DISPOSAL_REQUIRED for a payload missing carcassDisposal', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'death',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({ cause: 'Old age' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('DEATH_DISPOSAL_REQUIRED');
    expect(observationCreateMock).not.toHaveBeenCalled();
    expect(observationUpsertMock).not.toHaveBeenCalled();
  });

  it('returns 422 DEATH_DISPOSAL_REQUIRED for a disposal value outside the enum', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'death',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({
          cause: 'Old age',
          carcassDisposal: 'COMPOSTED',
        }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('DEATH_DISPOSAL_REQUIRED');
  });

  it('lets a clean single-cause + disposal=BURIED death through (200)', async () => {
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'death',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({
          cause: 'Old age',
          carcassDisposal: 'BURIED',
        }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, id: 'obs-1' });
  });

  it('does NOT block a non-death observation (scope-discipline guarantee)', async () => {
    // Smoke: the death validator must be a no-op for other observation
    // types, so PRD #253 (reproduction) and other surfaces stay green.
    const { POST } = await import('@/app/api/observations/route');
    const res = await POST(
      postObservationReq({
        type: 'weighing',
        camp_id: 'CAMP-1',
        animal_id: 'COW-001',
        details: JSON.stringify({ weight_kg: '450' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(observationCreateMock).toHaveBeenCalled();
  });
});
