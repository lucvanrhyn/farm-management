/**
 * @vitest-environment jsdom
 *
 * __tests__/app/root-layout-lang.test.tsx
 *
 * Visual audit P1 (2026-05-04): `app/layout.tsx` declares
 * `<html lang="af-ZA">` while every rendered string in the UI is in
 * English ("Sign In", "Create Your Account", "Username", …).
 * Screen readers pronounce the English text with Afrikaans phonemes,
 * search-engine signals are wrong, and the skip-to-content link reads
 * "Spring na inhoud" — confusing every keyboard / screen-reader user
 * who hits Tab.
 *
 * The fix is to declare the document language consistently with the
 * rendered copy. We pin the contract here so a future "let me hard-code
 * af-ZA back" change shows up in code review. When/if a real i18n
 * workstream lands the test should evolve to assert per-locale routing.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// next/font/google + next/font/local are build-time loaders that throw at
// runtime under Node — stub them out with the same `{ variable }` shape
// the layout reads.
vi.mock('next/font/google', () => {
  const fontStub = () => ({ variable: '--font-stub' });
  return {
    Geist: fontStub,
    Geist_Mono: fontStub,
    Playfair_Display: fontStub,
    DM_Sans: fontStub,
    DM_Serif_Display: fontStub,
  };
});

const RootLayout = (await import('@/app/layout')).default;

describe('RootLayout — document language (visual audit P1)', () => {
  // Render the layout to static HTML once and reuse the markup for all
  // assertions. Tailwind/font CSS variables are noisy; we only inspect
  // the structural attributes.
  const html = renderToStaticMarkup(
    RootLayout({ children: null as unknown as React.ReactNode }),
  );

  it('declares <html lang="en-ZA"> (matches rendered English copy)', () => {
    expect(html).toMatch(/<html[^>]*\blang="en-ZA"/);
    expect(html).not.toMatch(/<html[^>]*\blang="af-ZA"/);
  });

  it('uses an English skip-to-content link', () => {
    expect(html).toContain('Skip to content');
    // Regression guard — Afrikaans copy must not creep back in.
    expect(html).not.toContain('Spring na inhoud');
  });

  it('skip-link still targets #main wrapper (a11y contract preserved)', () => {
    expect(html).toMatch(/href="#main"/);
    expect(html).toMatch(/id="main"/);
  });
});
