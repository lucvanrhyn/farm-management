/**
 * sessionStorage wrapper for the AI Import Wizard state.
 *
 * Persists partial OnboardingState between page navigations within a single
 * browser tab. All helpers no-op safely during SSR (no window) and in
 * private-mode browsers where sessionStorage throws.
 */

import type { OnboardingState } from "@/lib/onboarding/client-types";

export const ONBOARDING_STORAGE_KEY = "farmtrack:onboarding:v1";

// Probe result is cached to avoid repeated try/catch on every save.
let cachedProbe: boolean | null = null;

function hasBrowserSessionStorage(): boolean {
  if (cachedProbe !== null) return cachedProbe;
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    cachedProbe = false;
    return false;
  }
  // Safari private mode exposes sessionStorage but throws on setItem.
  // Probe once so saveOnboardingState doesn't spam warnings on every state change.
  try {
    const k = "__farmtrack_probe__";
    window.sessionStorage.setItem(k, "1");
    window.sessionStorage.removeItem(k);
    cachedProbe = true;
  } catch {
    cachedProbe = false;
  }
  return cachedProbe;
}

export function loadOnboardingState(): Partial<OnboardingState> | null {
  if (!hasBrowserSessionStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Partial<OnboardingState>;
  } catch (err) {
    // Log and return null — never break the UI because of a storage failure.
    console.warn("[onboarding] loadOnboardingState failed:", err);
    return null;
  }
}

export function saveOnboardingState(state: Partial<OnboardingState>): void {
  if (!hasBrowserSessionStorage()) return;
  try {
    window.sessionStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("[onboarding] saveOnboardingState failed:", err);
  }
}

export function clearOnboardingState(): void {
  if (!hasBrowserSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch (err) {
    console.warn("[onboarding] clearOnboardingState failed:", err);
  }
}
