// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Preserve the original sessionStorage descriptor so the probe-failure test
 * can swap it out and restore cleanly. Without this, a subsequent test's
 * `window.sessionStorage.clear()` call in beforeEach would hit the stub.
 */
const ORIGINAL_SESSION_STORAGE_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  window,
  "sessionStorage",
);

afterEach(() => {
  if (ORIGINAL_SESSION_STORAGE_DESCRIPTOR) {
    Object.defineProperty(
      window,
      "sessionStorage",
      ORIGINAL_SESSION_STORAGE_DESCRIPTOR,
    );
  }
});

/**
 * Storage tests run in jsdom so `window.sessionStorage` is real. The module
 * caches its probe result at module scope, so we re-import via `vi.resetModules`
 * between tests that need a fresh probe (e.g. the broken-setItem scenario).
 */

// Ensure a clean slate for each test: reset modules so the cached probe is
// recomputed against the current sessionStorage state, and wipe storage.
beforeEach(() => {
  vi.resetModules();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

async function loadStorage() {
  return await import("@/lib/onboarding/storage");
}

describe("loadOnboardingState / saveOnboardingState round-trip", () => {
  it("saves and loads the same partial state", async () => {
    const { saveOnboardingState, loadOnboardingState } = await loadStorage();
    saveOnboardingState({ species: "sheep" });
    expect(loadOnboardingState()).toEqual({ species: "sheep" });
  });

  it("clearOnboardingState removes persisted state", async () => {
    const { saveOnboardingState, loadOnboardingState, clearOnboardingState } =
      await loadStorage();
    saveOnboardingState({ species: "goats" });
    clearOnboardingState();
    expect(loadOnboardingState()).toBeNull();
  });
});

describe("loadOnboardingState — malformed payloads return null instead of throwing", () => {
  it("returns null for corrupt JSON", async () => {
    const { ONBOARDING_STORAGE_KEY, loadOnboardingState } = await loadStorage();
    window.sessionStorage.setItem(ONBOARDING_STORAGE_KEY, "{not json");
    expect(loadOnboardingState()).toBeNull();
  });

  it("returns null for non-object JSON (array)", async () => {
    const { ONBOARDING_STORAGE_KEY, loadOnboardingState } = await loadStorage();
    window.sessionStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify([]));
    expect(loadOnboardingState()).toBeNull();
  });

  it("returns null for non-object JSON (primitive)", async () => {
    const { ONBOARDING_STORAGE_KEY, loadOnboardingState } = await loadStorage();
    window.sessionStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(42));
    expect(loadOnboardingState()).toBeNull();
  });
});

describe("probe failure — private mode / broken setItem", () => {
  it("silently no-ops and only warns once when probe fails", async () => {
    // Replace window.sessionStorage with a stub that always throws on setItem.
    // (Directly assigning `window.sessionStorage = mock` is supported in jsdom
    // because the property is configurable on the window object.)
    let setItemCallCount = 0;
    const throwingStorage: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        setItemCallCount++;
        throw new Error("QuotaExceededError");
      },
    };
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: throwingStorage,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { saveOnboardingState, loadOnboardingState, clearOnboardingState } =
      await loadStorage();

    // All helpers no-op without throwing.
    expect(() => saveOnboardingState({ species: "cattle" })).not.toThrow();
    expect(() => saveOnboardingState({ species: "sheep" })).not.toThrow();
    expect(loadOnboardingState()).toBeNull();
    expect(() => clearOnboardingState()).not.toThrow();

    // Probe happens during the FIRST helper call. After that the cached
    // `false` short-circuits and no further setItem calls happen — so we
    // never see the "saveOnboardingState failed" warning spam.
    expect(warnSpy).not.toHaveBeenCalled();

    // setItem was called once (the probe) and not again.
    expect(setItemCallCount).toBe(1);
  });
});
