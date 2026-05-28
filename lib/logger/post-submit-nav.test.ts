/**
 * @vitest-environment node
 *
 * Issue #465 (child of #464) — unit tests for the pure post-submit
 * navigation resolver `resolvePostSubmitNav`.
 *
 * Root cause this resolver fixes: the camp-condition submit handler in
 * `app/[farmSlug]/logger/[campId]/page.tsx` ran `router.push(loggerRoot)`
 * UNCONDITIONALLY after queuing. When offline, that client navigation was
 * served by the Serwist service worker, which fell back to `/offline` —
 * unmounting `OfflineProvider` and stranding the just-queued submit (its
 * `online → syncNow` auto-drain handler is torn down with the provider).
 *
 * The resolver is the single source of truth for "after a camp-condition
 * submit, do we navigate away or stay put?". It is intentionally pure —
 * no React, router, fetch, or IndexedDB imports — so every online/offline ×
 * sync-failure-resolution permutation from the acceptance criteria is pinned
 * here, fast and deterministic.
 *
 * Decision table (issue #465 acceptance criteria):
 *
 *   isOnline=false (queued locally, never POSTed)        → { action: "hold" }
 *       The fix. Stay in the logger so OfflineProvider stays mounted and its
 *       reconnect auto-drain fires. The offline fallback page never appears.
 *
 *   isOnline=true,  inline POST 2xx (committed)           → { action: "navigate" }
 *       Unchanged happy path — navigate back to the logger root.
 *
 *   isOnline=true,  fetch threw (network drop mid-submit) → { action: "navigate" }
 *       Treated like the offline-tolerant happy path today: the queued row is
 *       retried by the next sync cycle; the farmer is not stranded on the modal.
 *       (Mirrors the page's pre-fix catch-block behaviour.)
 *
 *   isOnline=true,  422 DUPLICATE auto-resolved
 *                   (classifier: mark-succeeded + remoteId) → { action: "navigate" }
 *       Server already has the canonical row; navigate so the camp tile shows
 *       the existing condition.
 *
 *   isOnline=true,  recoverable failure
 *                   (classifier: mark-failed-terminal
 *                    or retry-with-cooldown)               → { action: "hold" }
 *       Stay on the camp page so the farmer can react to the surfaced toast.
 */
import { describe, it, expect } from "vitest";
import {
  resolvePostSubmitNav,
  type PostSubmitNavInput,
} from "./post-submit-nav";
import type { SyncFailureResolution } from "@/lib/sync/failure-classifier";

const LOGGER_ROOT = "/trio-b-boerdery/logger";

describe("resolvePostSubmitNav — offline path (issue #465 root cause)", () => {
  it("offline submit holds — never navigates to the SW /offline fallback", () => {
    const input: PostSubmitNavInput = {
      isOnline: false,
      loggerRoot: LOGGER_ROOT,
    };
    expect(resolvePostSubmitNav(input)).toEqual({ action: "hold" });
  });

  it("offline path ignores any stray inline-POST outcome (there is no POST when offline)", () => {
    // Defensive: even if a caller passed an inlineResult while offline, the
    // offline branch is decided first — we hold so the provider stays mounted.
    const input: PostSubmitNavInput = {
      isOnline: false,
      loggerRoot: LOGGER_ROOT,
      inlineResult: { kind: "ok" },
    };
    expect(resolvePostSubmitNav(input)).toEqual({ action: "hold" });
  });
});

describe("resolvePostSubmitNav — online happy paths (unchanged behaviour)", () => {
  it("online + committed (inline POST 2xx) navigates to logger root", () => {
    const input: PostSubmitNavInput = {
      isOnline: true,
      loggerRoot: LOGGER_ROOT,
      inlineResult: { kind: "ok" },
    };
    expect(resolvePostSubmitNav(input)).toEqual({
      action: "navigate",
      to: LOGGER_ROOT,
    });
  });

  it("online + fetch threw mid-submit navigates (queued row drains later; farmer not stranded)", () => {
    const input: PostSubmitNavInput = {
      isOnline: true,
      loggerRoot: LOGGER_ROOT,
      inlineResult: { kind: "threw" },
    };
    expect(resolvePostSubmitNav(input)).toEqual({
      action: "navigate",
      to: LOGGER_ROOT,
    });
  });
});

describe("resolvePostSubmitNav — online × sync-failure resolution", () => {
  const dupAutoResolved: SyncFailureResolution = {
    action: "mark-succeeded",
    remoteId: "obs_existing_123",
    toast: { kind: "duplicate", message: "Already logged today" },
  };
  const dupTerminal: SyncFailureResolution = {
    action: "mark-failed-terminal",
    toast: { kind: "duplicate", message: "Duplicate — no existing id" },
  };
  const invalidTerminal: SyncFailureResolution = {
    action: "mark-failed-terminal",
    toast: { kind: "invalid", message: "Type not recognised" },
  };
  const retriable: SyncFailureResolution = {
    action: "retry-with-cooldown",
    toast: { kind: "error", message: "Sync failed — will retry" },
  };

  it("online + 422 DUPLICATE auto-resolved (mark-succeeded) navigates to logger root", () => {
    const input: PostSubmitNavInput = {
      isOnline: true,
      loggerRoot: LOGGER_ROOT,
      inlineResult: { kind: "rejected", resolution: dupAutoResolved },
    };
    expect(resolvePostSubmitNav(input)).toEqual({
      action: "navigate",
      to: LOGGER_ROOT,
    });
  });

  it("online + terminal duplicate (mark-failed-terminal) holds so the farmer sees the toast", () => {
    const input: PostSubmitNavInput = {
      isOnline: true,
      loggerRoot: LOGGER_ROOT,
      inlineResult: { kind: "rejected", resolution: dupTerminal },
    };
    expect(resolvePostSubmitNav(input)).toEqual({ action: "hold" });
  });

  it("online + invalid-type terminal (mark-failed-terminal) holds", () => {
    const input: PostSubmitNavInput = {
      isOnline: true,
      loggerRoot: LOGGER_ROOT,
      inlineResult: { kind: "rejected", resolution: invalidTerminal },
    };
    expect(resolvePostSubmitNav(input)).toEqual({ action: "hold" });
  });

  it("online + retriable 5xx (retry-with-cooldown) holds so the farmer can react", () => {
    const input: PostSubmitNavInput = {
      isOnline: true,
      loggerRoot: LOGGER_ROOT,
      inlineResult: { kind: "rejected", resolution: retriable },
    };
    expect(resolvePostSubmitNav(input)).toEqual({ action: "hold" });
  });
});
