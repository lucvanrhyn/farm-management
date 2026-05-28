'use client';

/**
 * components/logger/FailedSyncDialog.tsx — Issue #209
 *
 * Dead-letter UI surfaced by `LoggerStatusBar` when `failedCount > 0`.
 *
 * Closes Codex audit gap C3 ("stuck-row invisibility"): the row's failure
 * metadata captured by #208 now has a user-facing surface and a retry path.
 *
 * Retry semantics (the load-bearing contract — see also #206 / #207):
 *   - Per-row "Retry" flips `sync_status` back to `pending` WITHOUT touching
 *     `clientLocalId`. The next sync cycle POSTs the row with the same UUID
 *     the original attempt did. The server upserts on `clientLocalId`, so
 *     even if a previous attempt was actually received but the response was
 *     lost, exactly one row exists.
 *   - Audit history (`attempts`, `firstFailedAt`, `lastError`,
 *     `lastStatusCode`) stays on the row through the re-queue. We only clear
 *     those on a subsequent SUCCESS (`applySuccessMeta` in offline-store).
 *     That way "Attempted 3 times" stays readable while the user watches the
 *     retry sync cycle fly.
 *   - "Retry all" flips every visible row back to pending in a single pass
 *     then triggers ONE sync cycle via `useOffline().syncNow`.
 *   - As rows succeed they drop out of the failed bucket; we re-poll and
 *     auto-close the dialog when the list is empty.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getFailedObservations,
  getFailedAnimals,
  getFailedCoverReadings,
  markObservationPending,
  markAnimalCreatePending,
  markCoverReadingPending,
  discardFailedObservation,
  discardFailedAnimalCreate,
  discardFailedCoverReading,
  isTerminalFailure,
  type PendingObservation,
  type PendingAnimalCreate,
  type PendingCoverReading,
} from '@/lib/offline-store';
import { runDeadLetterCleanup } from '@/lib/offline-bcs-dead-letter-cleanup';
import { useOffline } from './OfflineProvider';

type FailedKind = 'observation' | 'animal' | 'cover-reading';

interface FailedRowView {
  kind: FailedKind;
  localId: number;
  /** RFC 4122 v4 UUID — the idempotency contract from #206 / #207. */
  clientLocalId: string | undefined;
  typeLabel: string;
  subjectLabel: string;
  lastError: string | null;
  lastStatusCode: number | null;
  attempts: number;
  firstFailedAt: number | null;
  /**
   * Issue #324 — a row whose most-recent failure was a terminal 4xx
   * (400/404/422) is a poison message: the re-queue writers no-op on it, so
   * "Retry" can never drain it. Terminal rows get a Discard control instead.
   */
  isTerminal: boolean;
  /**
   * Issue #366 — the row failed because `createObservation` rejected it as a
   * byte-identical duplicate camp_condition (409 DUPLICATE_OBSERVATION).
   * Surfaced with a clear "already logged" message + a Discard control: the
   * row holds the identical payload so a blind retry is futile.
   */
  isDuplicate: boolean;
  /** Issue #366 — the "already logged" copy when `isDuplicate` is true. */
  duplicateMessage: string;
}

const ERROR_DISPLAY_MAX_CHARS = 120;

/**
 * Issue #366 — recognise a byte-identical duplicate camp_condition
 * rejection in a failed row's diagnostics.
 *
 * `createObservation` rejects a second-mount duplicate by throwing
 * `DuplicateObservationError`; the API mapper renders it as
 * `422 { error: "DUPLICATE_OBSERVATION", details: { existingId } }`, and
 * the sync manager records that response body verbatim in `lastError`.
 *
 * 422 already makes the row terminal under `isTerminalStatus` (a duplicate
 * is a poison message — its identical payload re-rejects identically
 * forever), so the existing Discard machinery handles it. This helper only
 * REFINES the message: a generic terminal poison row says "the data needs
 * fixing on a fresh entry", which is wrong for a duplicate — the data was
 * already saved. The duplicate copy: a clear "already logged" notice.
 *
 * Pure + exported so the camp_condition duplicate-display contract is
 * unit-testable without mounting the IDB-bound dialog.
 */
export function describeDuplicateFailure(row: {
  lastError: string | null;
  lastStatusCode: number | null;
}): { isDuplicate: boolean; message: string } {
  const NOT_DUP = { isDuplicate: false, message: '' };
  if (row.lastStatusCode !== 422 || !row.lastError) return NOT_DUP;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.lastError);
  } catch {
    return NOT_DUP;
  }
  const code =
    parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).error
      : undefined;
  if (code !== 'DUPLICATE_OBSERVATION') return NOT_DUP;
  return {
    isDuplicate: true,
    message:
      'This camp condition was already logged today — the duplicate copy was not saved. Discard this stuck entry.',
  };
}

function truncateForDisplay(s: string | null): string {
  if (!s) return '';
  return s.length > ERROR_DISPLAY_MAX_CHARS
    ? `${s.slice(0, ERROR_DISPLAY_MAX_CHARS)}…`
    : s;
}

function formatRelativeFromEpoch(ts: number | null): string {
  if (ts === null) return 'just now';
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function observationTypeLabel(type: string): string {
  // The Logger writes ~10 observation types; the dialog needs a human-readable
  // label per row. The full mapping lives in `lib/species/` but is heavyweight
  // for a tiny dialog. We render the canonical snake_case label with the most
  // common types spelled out — anything unknown falls back to the raw type so
  // the user can still tell what the queue is holding.
  switch (type) {
    case 'camp_condition':
      return 'Camp condition';
    case 'health_issue':
      return 'Health issue';
    case 'weighing':
      return 'Weighing';
    case 'treatment':
      return 'Treatment';
    case 'movement':
      return 'Movement';
    case 'camp_move':
      return 'Camp move';
    case 'status_change':
      return 'Status change';
    case 'reproduction':
      return 'Reproduction';
    case 'calving':
      return 'Calving';
    default:
      return type.replace(/_/g, ' ');
  }
}

function mapObservation(o: PendingObservation): FailedRowView {
  // Issue #366 — a 409 DUPLICATE_OBSERVATION rejection is non-retryable in
  // practice (the row holds the identical payload). Surface it with the
  // "already logged" message and route it through the Discard control.
  const dup = describeDuplicateFailure({
    lastError: o.lastError,
    lastStatusCode: o.lastStatusCode,
  });
  return {
    kind: 'observation',
    localId: o.local_id!,
    clientLocalId: o.clientLocalId,
    typeLabel: observationTypeLabel(o.type),
    subjectLabel: o.animal_id ? `${o.animal_id} · Camp ${o.camp_id}` : `Camp ${o.camp_id}`,
    lastError: o.lastError,
    lastStatusCode: o.lastStatusCode,
    attempts: o.attempts,
    firstFailedAt: o.firstFailedAt,
    isTerminal: isTerminalFailure(o),
    isDuplicate: dup.isDuplicate,
    duplicateMessage: dup.message,
  };
}

function mapAnimal(a: PendingAnimalCreate): FailedRowView {
  return {
    kind: 'animal',
    localId: a.local_id!,
    clientLocalId: a.clientLocalId,
    typeLabel: 'Animal arrival',
    subjectLabel: a.name ? `${a.animal_id} · ${a.name}` : a.animal_id,
    lastError: a.lastError,
    lastStatusCode: a.lastStatusCode,
    attempts: a.attempts,
    firstFailedAt: a.firstFailedAt,
    isTerminal: isTerminalFailure(a),
    isDuplicate: false,
    duplicateMessage: '',
  };
}

function mapCover(c: PendingCoverReading): FailedRowView {
  return {
    kind: 'cover-reading',
    localId: c.local_id!,
    clientLocalId: c.clientLocalId,
    typeLabel: 'Cover reading',
    subjectLabel: `Camp ${c.camp_id} · ${c.cover_category}`,
    lastError: c.lastError,
    lastStatusCode: c.lastStatusCode,
    attempts: c.attempts,
    firstFailedAt: c.firstFailedAt,
    isTerminal: isTerminalFailure(c),
    isDuplicate: false,
    duplicateMessage: '',
  };
}

async function loadFailedRows(): Promise<FailedRowView[]> {
  const [obs, animals, covers] = await Promise.all([
    getFailedObservations(),
    getFailedAnimals(),
    getFailedCoverReadings(),
  ]);
  // Interleave by groupName so the user sees Observation rows first, then
  // animals, then cover readings. Grouping vs. interleaving is a wash for
  // a typical dead-letter list of 1-10 rows; grouping is easier to scan.
  return [...obs.map(mapObservation), ...animals.map(mapAnimal), ...covers.map(mapCover)];
}

async function retryRow(row: FailedRowView): Promise<void> {
  switch (row.kind) {
    case 'observation':
      await markObservationPending(row.localId);
      return;
    case 'animal':
      await markAnimalCreatePending(row.localId);
      return;
    case 'cover-reading':
      await markCoverReadingPending(row.localId);
      return;
  }
}

async function discardRow(row: FailedRowView): Promise<void> {
  switch (row.kind) {
    case 'observation':
      await discardFailedObservation(row.localId);
      return;
    case 'animal':
      await discardFailedAnimalCreate(row.localId);
      return;
    case 'cover-reading':
      await discardFailedCoverReading(row.localId);
      return;
  }
}

interface FailedSyncDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export default function FailedSyncDialog({ isOpen, onClose }: FailedSyncDialogProps) {
  const { syncNow, refreshPendingCount } = useOffline();
  const [rows, setRows] = useState<FailedRowView[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const next = await loadFailedRows();
    setRows(next);
    // Auto-close when the failed list drains. This handles both per-row retry
    // and "Retry all": as the sync cycle completes and rows transition to
    // synced, the next poll observes the empty list and closes the dialog so
    // the user gets immediate feedback that their retries landed.
    if (next.length === 0) {
      onClose();
    }
  }, [onClose]);

  // Reload whenever the dialog opens. We do not poll continuously: instead we
  // re-fetch after every user action (retry / retry-all / syncNow) plus once
  // on open. This keeps the dialog cheap when sitting idle and avoids racing
  // an IDB write the user just triggered.
  //
  // Issue #457 — drain dead-letters on open BEFORE loading rows, then re-read.
  // The mount-time cleanup in OfflineProvider is fire-and-forget, so opening
  // the dialog soon after mount could otherwise render rows the cleanup would
  // have drained (e.g. Trio B's stuck "Failed: 2"). Awaiting the cleanup here
  // (it never throws — resolves `{ removed }`) and re-reading inside `reload`
  // guarantees a drainable row is gone by render time. The sweep is cheap and
  // idempotent, so re-running on every open is safe.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      await runDeadLetterCleanup();
      if (!cancelled) await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, reload]);

  const onRetryOne = useCallback(
    async (row: FailedRowView) => {
      if (busy) return;
      setBusy(true);
      try {
        await retryRow(row);
        // Reload so the user sees the row drop to "pending" immediately, then
        // fire the sync cycle. The sync cycle's completion updates the
        // OfflineProvider's pendingCount/failedCount via `refreshPendingCount`
        // which the status bar reads.
        await reload();
        await syncNow();
        await refreshPendingCount();
        await reload();
      } finally {
        setBusy(false);
      }
    },
    [busy, reload, syncNow, refreshPendingCount],
  );

  const onRetryAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Snapshot the current visible rows so we re-queue exactly what the user
      // saw — if a row were added between the click and the loop, it would be
      // out of scope for this batch.
      // Issue #324 — skip terminal poison rows. The re-queue writers no-op
      // on them anyway; iterating them here would falsely imply they were
      // re-armed. They stay visible with their own Discard control.
      // Issue #366 — also skip duplicate-rejected rows: the row holds the
      // identical payload, so a re-POST is rejected as a duplicate again.
      const snapshot = rows.filter((r) => !r.isTerminal && !r.isDuplicate);
      for (const row of snapshot) {
        await retryRow(row);
      }
      await reload();
      await syncNow();
      await refreshPendingCount();
      await reload();
    } finally {
      setBusy(false);
    }
  }, [busy, rows, reload, syncNow, refreshPendingCount]);

  const onDiscardOne = useCallback(
    async (row: FailedRowView) => {
      if (busy) return;
      setBusy(true);
      try {
        // Permanently drop a poison row. No sync cycle — the payload is
        // server-rejected and unrecoverable; reload lets the list drain (and
        // auto-close when empty) so the farmer escapes the dead-end.
        await discardRow(row);
        await reload();
        await refreshPendingCount();
        await reload();
      } finally {
        setBusy(false);
      }
    },
    [busy, reload, refreshPendingCount],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Failed sync rows"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-t-3xl p-6 flex flex-col gap-4 max-h-[85dvh] overflow-y-auto"
        style={{ backgroundColor: '#1E0F07', boxShadow: '0 -8px 40px rgba(0,0,0,0.6)' }}
      >
        <div className="flex justify-center">
          <div
            className="w-10 h-1.5 rounded-full"
            style={{ backgroundColor: 'rgba(139, 105, 20, 0.4)' }}
          />
        </div>

        <div className="flex items-center justify-between">
          <h2
            className="font-bold text-lg"
            style={{ fontFamily: 'var(--font-display)', color: '#F5F0E8' }}
          >
            Failed to sync ({rows.length})
          </h2>
          <button
            type="button"
            onClick={onRetryAll}
            disabled={busy || rows.length === 0}
            className="text-xs font-bold px-3 py-1.5 rounded-full disabled:opacity-40"
            style={{ backgroundColor: '#B33A3A', color: '#F5F0E8' }}
          >
            Retry all
          </button>
        </div>

        <p className="text-xs" style={{ color: 'rgba(210, 180, 140, 0.7)' }}>
          These rows failed to upload. Retry keeps your original record id so
          duplicates can&apos;t be created server-side.
        </p>

        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={`${row.kind}:${row.localId}`}
              data-testid={`failed-row-${row.kind}-${row.localId}`}
              className="flex flex-col gap-2 p-3 rounded-xl"
              style={{
                backgroundColor: 'rgba(44, 21, 8, 0.55)',
                border: '1px solid rgba(179, 58, 58, 0.35)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: '#B33A3A' }}
                  >
                    {row.typeLabel}
                  </span>
                  <span className="text-sm font-medium" style={{ color: '#F5F0E8' }}>
                    {row.subjectLabel}
                  </span>
                </div>
                {row.isTerminal || row.isDuplicate ? (
                  <button
                    type="button"
                    data-testid={`discard-row-${row.kind}-${row.localId}`}
                    onClick={() => onDiscardOne(row)}
                    disabled={busy}
                    className="text-xs font-bold px-3 py-1.5 rounded-full disabled:opacity-40"
                    style={{ backgroundColor: '#6B4226', color: '#F5F0E8' }}
                  >
                    Discard
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid={`retry-row-${row.kind}-${row.localId}`}
                    onClick={() => onRetryOne(row)}
                    disabled={busy}
                    className="text-xs font-bold px-3 py-1.5 rounded-full disabled:opacity-40"
                    style={{ backgroundColor: '#B87333', color: '#F5F0E8' }}
                  >
                    Retry
                  </button>
                )}
              </div>
              {/* Issue #366 — a byte-identical duplicate gets its own clear
                  "already logged" copy; the generic terminal message is for
                  the malformed-payload poison-row case. */}
              {row.isDuplicate ? (
                <p
                  data-testid={`duplicate-msg-${row.kind}-${row.localId}`}
                  className="text-[11px] font-medium"
                  style={{ color: '#E0A050' }}
                >
                  {row.duplicateMessage}
                </p>
              ) : (
                row.isTerminal && (
                  <p
                    className="text-[11px] font-medium"
                    style={{ color: '#E0A050' }}
                  >
                    Rejected by the server — won&apos;t retry. The data needs
                    fixing on a fresh entry; discard this stuck copy.
                  </p>
                )
              )}
              <div
                className="text-xs flex flex-wrap gap-x-3 gap-y-1"
                style={{ color: 'rgba(210, 180, 140, 0.7)' }}
              >
                <span>Attempted {row.attempts} time{row.attempts === 1 ? '' : 's'}</span>
                {row.lastStatusCode !== null && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: 'rgba(179, 58, 58, 0.25)',
                      color: '#F5F0E8',
                    }}
                  >
                    HTTP {row.lastStatusCode}
                  </span>
                )}
                <span>Stuck {formatRelativeFromEpoch(row.firstFailedAt)}</span>
              </div>
              {row.lastError && (
                <p
                  className="text-xs italic"
                  style={{ color: 'rgba(210, 180, 140, 0.8)' }}
                >
                  {truncateForDisplay(row.lastError)}
                </p>
              )}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="text-sm py-2"
          style={{ color: 'rgba(210, 180, 140, 0.5)' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
