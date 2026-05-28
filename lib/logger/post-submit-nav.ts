/**
 * lib/logger/post-submit-nav.ts — Issue #465.
 *
 * Pure, dependency-free resolver for the camp-condition submit handler's
 * post-submit navigation decision. No React, router, fetch, or IndexedDB
 * imports — just logic — so it is trivially unit-testable.
 *
 * Root cause it fixes: `app/[farmSlug]/logger/[campId]/page.tsx` previously
 * ran `router.push(loggerRoot)` UNCONDITIONALLY after queuing a camp
 * condition. When offline, that client navigation was served by the Serwist
 * service worker, which fell back to `/offline` — unmounting `OfflineProvider`
 * and stranding the just-queued submit (the provider owns the IndexedDB queue
 * and the `online → syncNow` reconnect auto-drain; tearing it down breaks
 * auto-drain and forces a manual "Upload"). The resolver returns `"hold"` for
 * the offline path so the user stays in the logger, the provider stays
 * mounted, and the pending report drains automatically on reconnect.
 *
 * Decision table:
 *   isOnline=false                                   → hold
 *   isOnline=true, inline POST 2xx (committed)        → navigate
 *   isOnline=true, fetch threw (network drop)         → navigate (queued row
 *                                                       retries; not stranded)
 *   isOnline=true, 422 DUPLICATE auto-resolved
 *                  (mark-succeeded + remoteId)        → navigate
 *   isOnline=true, recoverable failure
 *                  (mark-failed-terminal / retry)     → hold (farmer reacts to
 *                                                       the surfaced toast)
 */

import type { SyncFailureResolution } from "@/lib/sync/failure-classifier";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Outcome of the inline online POST to /api/observations.
 *
 *  - `ok`       — the POST returned a 2xx; the row is committed server-side.
 *  - `threw`    — `fetch` itself threw (network drop mid-submit). The queued
 *                 IDB row will be retried by the next sync cycle.
 *  - `rejected` — the POST returned a non-2xx; `resolution` carries the typed
 *                 `classifySyncFailure` decision the page already computes.
 */
export type InlinePostResult =
  | { kind: "ok" }
  | { kind: "threw" }
  | { kind: "rejected"; resolution: SyncFailureResolution };

export interface PostSubmitNavInput {
  /** Whether the device reported online at submit time. */
  isOnline: boolean;
  /** Absolute logger-root path to navigate to on the happy path. */
  loggerRoot: string;
  /**
   * Outcome of the inline POST. Only meaningful when `isOnline === true`
   * (there is no inline POST when offline) — the offline branch is decided
   * first regardless of this field.
   */
  inlineResult?: InlinePostResult;
}

/** Navigate away to `to`, or stay put (hold) so the queue-owning provider stays mounted. */
export type PostSubmitNavDecision =
  | { action: "navigate"; to: string }
  | { action: "hold" };

// ── Implementation ──────────────────────────────────────────────────────────

/**
 * Resolve whether to navigate back to the logger root after a camp-condition
 * submit, or hold the user in the logger.
 *
 * @param input - Online state, logger-root path, and the inline POST outcome.
 * @returns A `PostSubmitNavDecision`.
 */
export function resolvePostSubmitNav(
  input: PostSubmitNavInput,
): PostSubmitNavDecision {
  // Offline: the submit was queued locally and never POSTed. Hold so the
  // service worker never serves the `/offline` fallback for a client
  // navigation — keeping OfflineProvider mounted and its reconnect
  // auto-drain alive. THIS is the issue #465 fix.
  if (!input.isOnline) {
    return { action: "hold" };
  }

  const result = input.inlineResult;

  // A committed 2xx, or a thrown fetch (network drop) — navigate. The thrown
  // case mirrors the pre-fix happy path: the queued row drains on the next
  // sync cycle, so we do not strand the farmer on the modal.
  if (!result || result.kind === "ok" || result.kind === "threw") {
    return { action: "navigate", to: input.loggerRoot };
  }

  // Rejected by the server. The classifier's auto-resolved duplicate
  // (mark-succeeded) means the server already holds the canonical row, so
  // navigate to show the existing condition on the camp tile.
  if (result.resolution.action === "mark-succeeded") {
    return { action: "navigate", to: input.loggerRoot };
  }

  // Any other resolution (terminal 422 or retriable 5xx) is recoverable from
  // the user's point of view — hold so the farmer can react to the toast.
  return { action: "hold" };
}
