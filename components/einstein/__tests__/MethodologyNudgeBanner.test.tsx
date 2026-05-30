// @vitest-environment jsdom
/**
 * Issue #526 — MethodologyNudgeBanner render + dismissal contract.
 *
 * The banner asks farms whose Farm Methodology Object is under-half-filled to
 * complete it, so Farm Einstein gets richer context. It must:
 *   - render ONLY when Einstein is enabled AND completeness is below the
 *     low-completeness threshold AND it has not been dismissed recently,
 *   - stay hidden when Einstein is disabled (kill-switch off),
 *   - stay hidden when completeness is at/above the threshold,
 *   - link the farmer to their Methodology settings page,
 *   - on dismiss, hide AND persist a timestamped flag in localStorage so a
 *     re-mount within the dismissal window stays hidden,
 *   - re-appear once the dismissal window has elapsed.
 *
 * Dismissal persistence is what makes this a *nudge* (not a nag) — the
 * regression these tests lock is "dismiss must survive a re-mount".
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  MethodologyNudgeBanner,
  MethodologyNudgeBannerProps,
} from '@/components/einstein/MethodologyNudgeBanner';
import { methodologyCompleteness } from '@/lib/einstein/methodology-completeness';

const LOW = methodologyCompleteness({ tier: 'a' }); // 1/6 → ratio < 0.5
const HALF = methodologyCompleteness({
  tier: 'a',
  speciesMix: 'b',
  breedingCalendar: 'c',
}); // 3/6 → ratio === 0.5 (NOT low)

function renderBanner(overrides: Partial<MethodologyNudgeBannerProps> = {}) {
  const props: MethodologyNudgeBannerProps = {
    farmSlug: 'demo-farm',
    einsteinEnabled: true,
    completeness: LOW,
    ...overrides,
  };
  return render(<MethodologyNudgeBanner {...props} />);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('MethodologyNudgeBanner', () => {
  it('renders when Einstein is enabled, completeness is low, and not dismissed', () => {
    renderBanner();
    expect(screen.getByTestId('methodology-nudge-banner')).toBeInTheDocument();
  });

  it('links to the farm Methodology settings page', () => {
    renderBanner();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      '/demo-farm/admin/settings/methodology',
    );
  });

  it('renders nothing when Einstein is disabled', () => {
    renderBanner({ einsteinEnabled: false });
    expect(
      screen.queryByTestId('methodology-nudge-banner'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing when completeness is at/above the threshold', () => {
    renderBanner({ completeness: HALF });
    expect(
      screen.queryByTestId('methodology-nudge-banner'),
    ).not.toBeInTheDocument();
  });

  it('hides on dismiss and persists the dismissal across a re-mount', () => {
    const { unmount } = renderBanner();
    expect(screen.getByTestId('methodology-nudge-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(
      screen.queryByTestId('methodology-nudge-banner'),
    ).not.toBeInTheDocument();

    unmount();
    renderBanner();
    // Still hidden after re-mount within the dismissal window.
    expect(
      screen.queryByTestId('methodology-nudge-banner'),
    ).not.toBeInTheDocument();
  });

  it('re-appears once the dismissal window has elapsed', () => {
    const key = 'farmtrack:methodology-nudge-dismissed:demo-farm';

    const { unmount } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    unmount();

    // The dismissal was persisted under the per-farm key…
    expect(window.localStorage.getItem(key)).toBeTruthy();
    // …now backdate it far beyond the window.
    const longAgo = Date.now() - 1000 * 60 * 60 * 24 * 365; // a year ago
    window.localStorage.setItem(key, String(longAgo));

    renderBanner();
    expect(screen.getByTestId('methodology-nudge-banner')).toBeInTheDocument();
  });

  it('ignores a corrupt persisted value and shows the banner', () => {
    window.localStorage.setItem(
      'farmtrack:methodology-nudge-dismissed:demo-farm',
      'not-a-number',
    );
    renderBanner();
    expect(screen.getByTestId('methodology-nudge-banner')).toBeInTheDocument();
  });
});
