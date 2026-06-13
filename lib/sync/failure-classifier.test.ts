/**
 * @vitest-environment node
 *
 * Issue #435 — pure `classifySyncFailure` unit-test matrix.
 *
 * Pins the classifier contract so any future change to failure routing
 * produces a named test failure rather than silent behaviour drift.
 *
 * Matrix rows (from acceptance criteria):
 *   - 422 DUPLICATE_OBSERVATION with existingId   → mark-succeeded (auto-resolve)
 *   - 422 DUPLICATE_OBSERVATION without existingId → mark-failed-terminal
 *   - 422 INVALID_TYPE                            → mark-failed-terminal
 *   - 422 VALIDATION_ERROR                        → mark-failed-terminal
 *   - 5xx                                         → retry-with-cooldown
 *   - network error (statusCode null)             → retry-with-cooldown
 *   - 200 success                                 → (not a failure; guard test)
 */

import { describe, it, expect } from 'vitest';
import { classifySyncFailure } from './failure-classifier';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Well-formed 422 DUPLICATE_OBSERVATION body with existingId. */
const DUPLICATE_WITH_ID = {
  error: 'DUPLICATE_OBSERVATION' as const,
  details: { existingId: 'obs-abc-123' },
};

/** 422 DUPLICATE_OBSERVATION body missing existingId (malformed). */
const DUPLICATE_WITHOUT_ID = {
  error: 'DUPLICATE_OBSERVATION' as const,
  details: {},
};

/** 422 INVALID_TYPE body. */
const INVALID_TYPE_BODY = { error: 'INVALID_TYPE' as const };

/** 422 VALIDATION_ERROR body. */
const VALIDATION_ERROR_BODY = { error: 'VALIDATION_ERROR' as const };

// ── Classifier matrix ────────────────────────────────────────────────────────

describe('classifySyncFailure — resolution matrix', () => {
  // ── DUPLICATE with existingId → auto-resolve ─────────────────────────────

  it('422 DUPLICATE_OBSERVATION with existingId → mark-succeeded with remoteId', () => {
    const result = classifySyncFailure(422, DUPLICATE_WITH_ID);
    expect(result.action).toBe('mark-succeeded');
    if (result.action === 'mark-succeeded') {
      expect(result.remoteId).toBe('obs-abc-123');
    }
  });

  it('mark-succeeded result carries a toast hint with kind=duplicate', () => {
    const result = classifySyncFailure(422, DUPLICATE_WITH_ID);
    expect(result.toast).toBeDefined();
    expect(result.toast?.kind).toBe('duplicate');
    expect(typeof result.toast?.message).toBe('string');
    expect(result.toast?.message.length).toBeGreaterThan(0);
  });

  // ── DUPLICATE without existingId → terminal (malformed payload) ──────────

  it('422 DUPLICATE_OBSERVATION without existingId → mark-failed-terminal', () => {
    const result = classifySyncFailure(422, DUPLICATE_WITHOUT_ID);
    expect(result.action).toBe('mark-failed-terminal');
  });

  it('422 DUPLICATE_OBSERVATION with null details → mark-failed-terminal', () => {
    const result = classifySyncFailure(422, { error: 'DUPLICATE_OBSERVATION' });
    expect(result.action).toBe('mark-failed-terminal');
  });

  // ── INVALID_TYPE → terminal ───────────────────────────────────────────────

  it('422 INVALID_TYPE → mark-failed-terminal', () => {
    const result = classifySyncFailure(422, INVALID_TYPE_BODY);
    expect(result.action).toBe('mark-failed-terminal');
  });

  it('mark-failed-terminal for INVALID_TYPE carries a toast with kind=invalid', () => {
    const result = classifySyncFailure(422, INVALID_TYPE_BODY);
    expect(result.toast?.kind).toBe('invalid');
  });

  // ── VALIDATION_ERROR → terminal ───────────────────────────────────────────

  it('422 VALIDATION_ERROR → mark-failed-terminal', () => {
    const result = classifySyncFailure(422, VALIDATION_ERROR_BODY);
    expect(result.action).toBe('mark-failed-terminal');
  });

  // ── Unknown 422 → terminal (safe default) ────────────────────────────────

  it('422 with unknown error code → mark-failed-terminal', () => {
    const result = classifySyncFailure(422, { error: 'SOME_UNKNOWN_ERROR' });
    expect(result.action).toBe('mark-failed-terminal');
  });

  // ── S5 / OBS-2 — typed 404 ANIMAL_NOT_FOUND → terminal ───────────────────

  it('404 ANIMAL_NOT_FOUND → mark-failed-terminal (S5/OBS-2)', () => {
    // A death/move (or any observation) replayed for an animal that genuinely
    // no longer exists server-side. With S4's drain ordering (animals sync to
    // completion BEFORE observations) a typed ANIMAL_NOT_FOUND can never be a
    // not-yet-synced offline calf — it is deterministic and re-rejects
    // identically forever, so the row must dead-letter, not loop.
    const result = classifySyncFailure(404, { error: 'ANIMAL_NOT_FOUND' });
    expect(result.action).toBe('mark-failed-terminal');
  });

  it('mark-failed-terminal for ANIMAL_NOT_FOUND carries a toast hint', () => {
    const result = classifySyncFailure(404, { error: 'ANIMAL_NOT_FOUND' });
    expect(result.toast).toBeDefined();
    expect(result.toast?.kind).toBe('error');
    expect(typeof result.toast?.message).toBe('string');
    expect(result.toast?.message.length).toBeGreaterThan(0);
  });

  it('UNTYPED 404 (no recognised code) → retry-with-cooldown (deploy-order safety)', () => {
    // A bare/legacy 404 (older server, "Not found"/"Mob not found" free-text,
    // or a transient routing miss) must NOT insta-poison the row — it stays in
    // the retry lane, bounded by the OBS-1 attempt budget. Only the typed
    // ANIMAL_NOT_FOUND code is proof of a genuinely-missing animal.
    expect(classifySyncFailure(404, { error: 'Not found' }).action).toBe('retry-with-cooldown');
    expect(classifySyncFailure(404, null).action).toBe('retry-with-cooldown');
    expect(classifySyncFailure(404, { error: 'Mob not found' }).action).toBe('retry-with-cooldown');
  });

  // ── 5xx → retry-with-cooldown ────────────────────────────────────────────

  it('500 → retry-with-cooldown', () => {
    const result = classifySyncFailure(500, { error: 'Internal Server Error' });
    expect(result.action).toBe('retry-with-cooldown');
  });

  it('503 → retry-with-cooldown', () => {
    const result = classifySyncFailure(503, null);
    expect(result.action).toBe('retry-with-cooldown');
  });

  // ── Network error (status null) → retry-with-cooldown ────────────────────

  it('null status (fetch threw) → retry-with-cooldown', () => {
    const result = classifySyncFailure(null, null);
    expect(result.action).toBe('retry-with-cooldown');
  });

  // ── Pure function contract ────────────────────────────────────────────────

  it('is a pure function — no IDB or fetch imports', async () => {
    // Import the module source and assert it has no 'idb' or 'fetch' imports.
    // This is a structural guard: if someone adds an IDB import the test name
    // makes the violation obvious.
    const source = await import('./failure-classifier?raw');
    // Vite raw imports give a `default` export with the source string.
    const src: string = (source as { default: string }).default;
    expect(src).not.toMatch(/from ['"]idb['"]/);
    expect(src).not.toMatch(/from ['"]@\/lib\/offline/);
    expect(src).not.toMatch(/globalThis\.fetch|window\.fetch/);
  });

  // ── Return shape ─────────────────────────────────────────────────────────

  it('mark-succeeded shape has no extra fields beyond action/remoteId/toast', () => {
    const result = classifySyncFailure(422, DUPLICATE_WITH_ID);
    // Allowed keys: action, remoteId, toast
    const keys = Object.keys(result);
    const unknown = keys.filter((k) => !['action', 'remoteId', 'toast'].includes(k));
    expect(unknown).toEqual([]);
  });
});
