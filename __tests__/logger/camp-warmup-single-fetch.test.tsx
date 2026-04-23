// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import React from 'react';

// P2 — logger fan-out de-dupe. CampWarmup previously fired its own
// `GET /api/camps` alongside the one OfflineProvider already triggers
// through refreshCachedData. On a cold visit that meant two concurrent
// camps round-trips racing (2535ms + 3125ms measured on Trio B). The
// fix: CampWarmup reads camps from useOffline() once campsLoaded flips
// true, and never calls fetch("/api/camps") itself. The warmup loop
// (per-camp HTML prefetch) still fires — this test just pins that the
// camps list source is the context, not a dedicated fetch.

vi.mock('next/navigation', () => ({
  useParams: () => ({ farmSlug: 'trio-b-boerdery' }),
  usePathname: () => '/trio-b-boerdery/logger',
}));

// Swap OfflineProvider for a controllable stub so we can:
//   1. avoid the real cache-read / sync-manager fan-out (those are covered by
//      sibling tests), and
//   2. feed a known camps list + campsLoaded signal directly into the layout.
//
// This mock is intentionally minimal — it exposes the two fields CampWarmup
// consumes and whatever LoggerHero needs.
const mockContextRef: {
  camps: { camp_id: string }[];
  campsLoaded: boolean;
  heroImageUrl: string | null;
} = { camps: [], campsLoaded: false, heroImageUrl: null };

vi.mock('@/components/logger/OfflineProvider', () => ({
  OfflineProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useOffline: () => mockContextRef,
}));

// Next.js <Image> needs a stub because jsdom has no image loader.
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { src, alt, ...rest } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...(rest as Record<string, unknown>)} />;
  },
}));

import LoggerLayout from '@/app/[farmSlug]/logger/layout';

beforeEach(() => {
  mockContextRef.camps = [];
  mockContextRef.campsLoaded = false;
  mockContextRef.heroImageUrl = null;
  // Fresh sessionStorage — CampWarmup guards the warmup loop with a per-tab
  // sessionStorage key.
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeFetchSpy() {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    return new Response('null', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

describe('CampWarmup — single-source /api/camps', () => {
  it('does not call /api/camps when campsLoaded turns true with cached camps', async () => {
    const calls = makeFetchSpy();
    mockContextRef.camps = [{ camp_id: 'A' }, { camp_id: 'B' }];
    mockContextRef.campsLoaded = true;

    render(
      <LoggerLayout>
        <div />
      </LoggerLayout>,
    );

    // Let any scheduled effects, microtasks and requestIdleCallback shims run.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const campsCalls = calls.filter((u) => u.startsWith('/api/camps'));
    expect(campsCalls).toHaveLength(0);
  });

  it('still prefetches per-camp pages using the context-provided list', async () => {
    const calls = makeFetchSpy();
    mockContextRef.camps = [{ camp_id: 'A' }, { camp_id: 'B' }];
    mockContextRef.campsLoaded = true;

    render(
      <LoggerLayout>
        <div />
      </LoggerLayout>,
    );

    // Prefetch uses requestIdleCallback or setTimeout 0; walk it forward.
    await waitFor(() => {
      const campPages = calls.filter((u) =>
        u.startsWith('/trio-b-boerdery/logger/'),
      );
      expect(campPages.length).toBeGreaterThan(0);
    });

    const campPages = calls.filter((u) =>
      u.startsWith('/trio-b-boerdery/logger/'),
    );
    // All requested camps come from context, not from a fresh fetch.
    for (const url of campPages) {
      expect(['A', 'B'].some((id) => url.includes(`/logger/${id}`))).toBe(true);
    }
    // And /api/camps was never called from the warmup.
    expect(calls.filter((u) => u.startsWith('/api/camps'))).toHaveLength(0);
  });

  it('waits for campsLoaded before starting the prefetch loop', async () => {
    const calls = makeFetchSpy();
    // Start with campsLoaded false and empty camps — warmup must not fire.
    mockContextRef.camps = [];
    mockContextRef.campsLoaded = false;

    const { rerender } = render(
      <LoggerLayout>
        <div />
      </LoggerLayout>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(calls.filter((u) => u.startsWith('/trio-b-boerdery/logger/'))).toHaveLength(0);
    expect(calls.filter((u) => u.startsWith('/api/camps'))).toHaveLength(0);

    // Flip campsLoaded and push a camps list — warmup now begins.
    mockContextRef.camps = [{ camp_id: 'C' }];
    mockContextRef.campsLoaded = true;

    rerender(
      <LoggerLayout>
        <div />
      </LoggerLayout>,
    );

    await waitFor(() => {
      const campPages = calls.filter((u) =>
        u.startsWith('/trio-b-boerdery/logger/'),
      );
      expect(campPages.length).toBeGreaterThan(0);
    });

    // No /api/camps ever fired from the warmup.
    expect(calls.filter((u) => u.startsWith('/api/camps'))).toHaveLength(0);
  });
});
