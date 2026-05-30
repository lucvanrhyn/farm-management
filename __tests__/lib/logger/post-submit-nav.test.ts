/**
 * Issue #447 — `resolveNavHoldMs` timing contract.
 *
 * The auto-resolved same-day duplicate is the only post-submit path that BOTH
 * surfaces a toast and navigates, so it is the only path that should hold the
 * navigation (so the toast is readable). Every other navigate path showed no
 * toast and must navigate immediately (`0` ms) — the happy path is never
 * slowed. This pins that pure decision so the component only has to schedule.
 */

import { describe, it, expect } from "vitest";

import {
  resolveNavHoldMs,
  DUPLICATE_TOAST_NAV_HOLD_MS,
  type InlinePostResult,
} from "@/lib/logger/post-submit-nav";
import type { SyncFailureResolution } from "@/lib/sync/failure-classifier";

const duplicateResolution: SyncFailureResolution = {
  action: "mark-succeeded",
  remoteId: "srv-existing-7",
  toast: { kind: "duplicate", message: "Already logged today." },
};

describe("resolveNavHoldMs (#447)", () => {
  it("holds 1.5s for the auto-resolved duplicate-toast navigate path", () => {
    const inlineResult: InlinePostResult = {
      kind: "rejected",
      resolution: duplicateResolution,
    };
    expect(resolveNavHoldMs(inlineResult)).toBe(DUPLICATE_TOAST_NAV_HOLD_MS);
    expect(DUPLICATE_TOAST_NAV_HOLD_MS).toBeGreaterThanOrEqual(1500);
  });

  it("does not hold a committed 2xx submit (immediate navigation)", () => {
    expect(resolveNavHoldMs({ kind: "ok" })).toBe(0);
  });

  it("does not hold a thrown fetch (immediate navigation)", () => {
    expect(resolveNavHoldMs({ kind: "threw" })).toBe(0);
  });

  it("does not hold when there is no inline result (offline / happy path)", () => {
    expect(resolveNavHoldMs(undefined)).toBe(0);
  });

  it("does not hold a terminal rejection (the page holds, it never navigates)", () => {
    const terminal: InlinePostResult = {
      kind: "rejected",
      resolution: {
        action: "mark-failed-terminal",
        toast: { kind: "invalid", message: "Invalid entry." },
      },
    };
    expect(resolveNavHoldMs(terminal)).toBe(0);
  });

  it("does not hold a non-duplicate mark-succeeded with no toast", () => {
    const noToast: InlinePostResult = {
      kind: "rejected",
      resolution: { action: "mark-succeeded", remoteId: "x" },
    };
    expect(resolveNavHoldMs(noToast)).toBe(0);
  });
});
