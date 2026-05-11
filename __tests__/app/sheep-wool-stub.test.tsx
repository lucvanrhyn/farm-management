/**
 * @vitest-environment jsdom
 *
 * __tests__/app/sheep-wool-stub.test.tsx
 *
 * Issue #204 — the sheep-shearing-due alert
 * (`lib/species/sheep/index.ts:223-237`) links to `/${farmSlug}/sheep/wool`,
 * but the route does not exist. Farmers who click the alert hit a 404.
 *
 * Until a real wool-tracking feature ships, we reserve the route with a
 * minimal "Coming soon" stub so the click-through resolves to a valid page.
 *
 * This test renders the stub page component directly (the alert href has
 * no query params, so we just need a 200-equivalent: the page resolves to
 * valid JSX containing the placeholder copy).
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';

describe('sheep/wool stub page (#204)', () => {
  it('renders a placeholder page with a "Coming soon" message', async () => {
    const mod = await import('@/app/[farmSlug]/sheep/wool/page');
    const Page = mod.default as (props: {
      params: Promise<{ farmSlug: string }>;
    }) => Promise<React.ReactElement>;

    const element = await Page({
      params: Promise.resolve({ farmSlug: 'acme-sheep' }),
    });

    expect(element).toBeTruthy();

    const html = renderToString(element);

    // Heading establishes the route — anchors the alert click-through.
    expect(html).toMatch(/Wool/i);
    // Placeholder copy makes the stub explicit to the farmer.
    expect(html).toMatch(/coming soon/i);
  });
});
