'use client';

/**
 * components/einstein/MethodologyNudgeBanner.tsx — Issue #526 (PRD #521 W-G / #29).
 *
 * Dismissible admin-shell banner that nudges farms whose Farm Methodology
 * Object is under-half-filled to complete it. A sparse Methodology degrades the
 * context Farm Einstein is given, so this is a low-friction adoption lever: it
 * tells the farmer "you've filled N of 6 — finish so Einstein understands your
 * farm" and links straight to the Methodology settings page.
 *
 * Render gate (all three required):
 *   1. `einsteinEnabled` — the RAG kill-switch (AiSettings.ragConfig.enabled).
 *      No point nudging Methodology if Einstein is off; the field only feeds
 *      Einstein's system prompt.
 *   2. `completeness.ratio < LOW_COMPLETENESS_THRESHOLD` — under-half-filled.
 *   3. Not dismissed within the last DISMISSAL_WINDOW_MS.
 *
 * Server/client split: the layout (a Server Component) computes
 * `completeness` from the already-parsed aiSettings blob and passes it down
 * with `einsteinEnabled`. ALL localStorage / Date logic lives here in the
 * client so the server stays I/O-pure and there is exactly one place that
 * owns "have they dismissed this".
 *
 * Hydration safety: the dismissed flag lives in localStorage, which the server
 * cannot read. `useSsrSafeState` renders the SSR-safe value (`true` = "treat as
 * dismissed") on the first paint, then resolves the real localStorage answer
 * after mount — so server and first client render agree (no React #418 flash)
 * and we never read localStorage during render. Dismissal prior art:
 * components/auth/SessionExpiryBanner.tsx + components/logger/OfflineBanner.tsx.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useSsrSafeState } from '@/lib/client/use-ssr-safe-state';
import {
  LOW_COMPLETENESS_THRESHOLD,
  type MethodologyCompleteness,
} from '@/lib/einstein/methodology-completeness';

/**
 * How long a dismissal suppresses the banner. Seven days = the farmer gets one
 * gentle reminder per week rather than on every admin page load — enough to be
 * a nudge, not a nag.
 */
export const DISMISSAL_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

/** localStorage key, namespaced per farm so multi-farm admins dismiss each independently. */
function dismissalStorageKey(farmSlug: string): string {
  return `farmtrack:methodology-nudge-dismissed:${farmSlug}`;
}

export interface MethodologyNudgeBannerProps {
  /** Farm slug — used for the settings link + per-farm dismissal key. */
  readonly farmSlug: string;
  /** RAG kill-switch (AiSettings.ragConfig.enabled). */
  readonly einsteinEnabled: boolean;
  /** Pre-computed score from `methodologyCompleteness` (server-side). */
  readonly completeness: MethodologyCompleteness;
}

/**
 * Read the persisted dismissal and decide whether it is still within the
 * suppression window. Defensive: any read failure (no localStorage, corrupt
 * value, non-numeric) is treated as "not dismissed" so the nudge errs toward
 * being shown rather than silently swallowed.
 */
function isDismissedWithinWindow(farmSlug: string, now: number): boolean {
  try {
    const raw = window.localStorage.getItem(dismissalStorageKey(farmSlug));
    if (!raw) return false;
    const dismissedAt = Number.parseInt(raw, 10);
    if (!Number.isFinite(dismissedAt)) return false;
    return now - dismissedAt < DISMISSAL_WINDOW_MS;
  } catch {
    return false;
  }
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: '0.5rem 0.75rem',
  padding: '0.625rem 1rem',
  fontSize: '0.875rem',
  lineHeight: 1.35,
  // Soft amber/gold — informational, not alarming. Mirrors the warning palette
  // used by SessionExpiryBanner's "expiring soon" variant.
  backgroundColor: '#FBF3DD',
  color: '#5C4A1E',
  borderBottom: '1px solid #E7D6A8',
};

const linkStyle: React.CSSProperties = {
  color: '#7A5E18',
  fontWeight: 600,
  textDecoration: 'underline',
};

const dismissButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #D9C690',
  borderRadius: '6px',
  padding: '0.25rem 0.5rem',
  color: '#5C4A1E',
  fontSize: '0.8125rem',
  fontWeight: 500,
  cursor: 'pointer',
  lineHeight: 1,
};

export function MethodologyNudgeBanner({
  farmSlug,
  einsteinEnabled,
  completeness,
}: MethodologyNudgeBannerProps) {
  const lowCompleteness = completeness.ratio < LOW_COMPLETENESS_THRESHOLD;
  const eligible = einsteinEnabled && lowCompleteness;

  // SSR-safe read: `true` (hidden) on the server + first paint, then the real
  // localStorage answer after mount. Errs toward hidden so the nudge never
  // flashes before we've confirmed it wasn't already dismissed.
  const persistedDismissed = useSsrSafeState<boolean>(true, () =>
    isDismissedWithinWindow(farmSlug, Date.now()),
  );
  // Local override so the in-session "Dismiss" click hides immediately without
  // waiting on a re-read.
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  if (!eligible) return null;
  if (persistedDismissed || dismissedThisSession) return null;

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(
        dismissalStorageKey(farmSlug),
        String(Date.now()),
      );
    } catch {
      // Persistence is best-effort; a private-mode quota error must not crash
      // the banner. The in-memory hide below still applies for this session.
    }
    setDismissedThisSession(true);
  };

  const methodologyHref = `/${farmSlug}/admin/settings/methodology`;

  return (
    <div
      data-testid="methodology-nudge-banner"
      role="status"
      aria-live="polite"
      style={containerStyle}
    >
      <span aria-hidden>💡</span>
      <span>
        Farm Einstein works best when it knows your farm. You&apos;ve filled{' '}
        {completeness.filled} of {completeness.total} Methodology fields —{' '}
        <Link href={methodologyHref} style={linkStyle}>
          complete your Farm Methodology
        </Link>{' '}
        for sharper answers.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        style={dismissButtonStyle}
        aria-label="Dismiss methodology reminder"
      >
        Dismiss
      </button>
    </div>
  );
}

export default MethodologyNudgeBanner;
