/**
 * lib/sync/failure-classifier.ts — Issue #435.
 *
 * Pure function that turns a server response into a typed `SyncFailureResolution`.
 * No IDB or fetch imports — this module is dependency-free and safe to call
 * from any context (service worker, offline provider, cleanup pass).
 *
 * Resolution table:
 *   - HTTP 422 DUPLICATE_OBSERVATION + existingId  → mark-succeeded (auto-resolve)
 *   - HTTP 422 DUPLICATE_OBSERVATION (no existingId) → mark-failed-terminal
 *   - HTTP 422 INVALID_TYPE                        → mark-failed-terminal
 *   - HTTP 422 (any other code)                    → mark-failed-terminal
 *   - HTTP 404 ANIMAL_NOT_FOUND                    → mark-failed-terminal (S5/OBS-2)
 *   - HTTP 404 (untyped/any other body)            → retry-with-cooldown
 *   - HTTP 5xx                                     → retry-with-cooldown
 *   - null status (fetch threw)                    → retry-with-cooldown
 *
 * The `toast` field is consumed by the logger UI (issue #436 camp-condition
 * submit handler) to surface human-readable feedback. It is set for every
 * resolution so callers can render it without branching on `action`.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Hint for the logger UI toast system. */
export interface SyncToastHint {
  /** Semantic kind — drives the icon / colour variant. */
  kind: 'duplicate' | 'invalid' | 'error';
  /** Human-readable message for the toast body. */
  message: string;
}

export type SyncResolutionAction =
  | 'mark-succeeded'
  | 'mark-failed-terminal'
  | 'retry-with-cooldown';

export interface SyncFailureResolution {
  action: SyncResolutionAction;
  /**
   * Server-assigned id to use when action === 'mark-succeeded'.
   * Populated only on the DUPLICATE_OBSERVATION auto-resolve path where
   * the server body contained `details.existingId`.
   */
  remoteId?: string;
  /** Presentation hint for the logger toast surface (issue #436). */
  toast?: SyncToastHint;
}

// ── Wire body types ───────────────────────────────────────────────────────────

interface ParsedBody {
  error?: string;
  details?: {
    existingId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DUPLICATE_OBSERVATION = 'DUPLICATE_OBSERVATION';
const INVALID_TYPE = 'INVALID_TYPE';
/**
 * S5 / OBS-2 — the typed 404 emitted by `POST /api/observations` when the
 * target animal genuinely does not exist server-side (door FK miss or a
 * death/move whose tag-keyed update hit Prisma P2025). Deterministic: the
 * identical payload re-rejects identically forever, so the row is terminal.
 */
const ANIMAL_NOT_FOUND = 'ANIMAL_NOT_FOUND';

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Classify a sync response into a typed resolution action.
 *
 * @param httpStatus - The HTTP status code, or `null` when fetch threw.
 * @param parsedBody - The parsed JSON body, or `null` when unavailable.
 * @returns A typed `SyncFailureResolution` indicating the next step.
 */
export function classifySyncFailure(
  httpStatus: number | null,
  parsedBody: unknown,
): SyncFailureResolution {
  // Network error (fetch threw) or any 5xx → retry.
  if (httpStatus === null || httpStatus >= 500) {
    return {
      action: 'retry-with-cooldown',
      toast: {
        kind: 'error',
        message: 'Sync failed — will retry automatically',
      },
    };
  }

  // 422 branch — classify by wire error code.
  if (httpStatus === 422) {
    const body = parsedBody as ParsedBody | null;
    const errorCode = body?.error;

    if (errorCode === DUPLICATE_OBSERVATION) {
      const existingId = body?.details?.existingId;

      // Well-formed DUPLICATE with existingId → auto-resolve to synced.
      if (typeof existingId === 'string' && existingId.length > 0) {
        return {
          action: 'mark-succeeded',
          remoteId: existingId,
          toast: {
            kind: 'duplicate',
            message: 'Already logged today — observation linked to existing record',
          },
        };
      }

      // Malformed DUPLICATE (no existingId) → terminal.
      return {
        action: 'mark-failed-terminal',
        toast: {
          kind: 'duplicate',
          message: 'Duplicate observation — server could not provide existing record id',
        },
      };
    }

    if (errorCode === INVALID_TYPE) {
      return {
        action: 'mark-failed-terminal',
        toast: {
          kind: 'invalid',
          message: 'Observation type not recognised — remove from queue to continue',
        },
      };
    }

    // Any other 422 (VALIDATION_ERROR, WRONG_SPECIES, etc.) → terminal.
    return {
      action: 'mark-failed-terminal',
      toast: {
        kind: 'error',
        message: 'Observation rejected by server — remove from queue to continue',
      },
    };
  }

  // S5 / OBS-2 — typed 404: the server PROVED the target animal no longer
  // exists (post-S4 the drain syncs pending animals to completion before any
  // observation, so this can never be a not-yet-synced offline calf). The row
  // dead-letters instead of looping. ONLY the typed code is terminal: an
  // untyped/legacy 404 ("Not found", "Mob not found", older servers, routing
  // misses) falls through to the retry arm below, bounded by the OBS-1
  // attempt budget — deploy-order safety for mixed client/server versions.
  if (httpStatus === 404) {
    const body = parsedBody as ParsedBody | null;
    if (body?.error === ANIMAL_NOT_FOUND) {
      return {
        action: 'mark-failed-terminal',
        toast: {
          kind: 'error',
          message: 'Animal no longer exists on the server — remove from queue to continue',
        },
      };
    }
  }

  // Any other non-success status → retry (4xx that aren't 422, unexpected codes).
  return {
    action: 'retry-with-cooldown',
    toast: {
      kind: 'error',
      message: 'Sync failed — will retry automatically',
    },
  };
}
