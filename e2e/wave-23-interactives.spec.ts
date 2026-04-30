import { test, expect } from "@playwright/test";

/**
 * Wave 23 — Broken interactives (F1 + F6)
 *
 * WHY COMPONENT-LEVEL INSTEAD OF FULL E2E:
 * These features are gated behind next-auth session authentication. Setting
 * up a Playwright auth fixture (seeded DB user + token cookie) requires either
 * a running Turso clone with a test tenant or a NextAuth credential provider
 * mock — both of which are integration concerns that live in the preview deploy
 * soak, not the CI smoke gate. The full behaviour is exercised at component
 * level via Vitest + RTL (see __tests__/components/admin/SpeciesAddModal.test.tsx
 * and __tests__/components/admin/SwitchFarmLink.test.tsx).
 *
 * What IS smoke-tested here (no auth required):
 *   F1-smoke: the /login page is reachable (baseline — species settings redirect
 *             there for unauthed users, so a 200 from /login confirms the route
 *             infrastructure works).
 *   F6-smoke: /farms redirects to /login for unauthed users (confirms the farm
 *             selector URL is wired and doesn't 404).
 *
 * Full acceptance:
 *   F1 — navigate to /<farmSlug>/admin/settings/species, click "+ Add species",
 *        modal appears with "Import from CSV" and "Add manually" CTAs, Esc
 *        dismisses. Verified in RTL suite + manual preview walkthrough.
 *   F6 — user with N≥2 farms sees "← Switch farm" link in AdminNav; N=1 sees
 *        none. Verified in RTL suite (farmCount prop) + manual preview.
 */

test("F1-smoke: /login returns 200 (species settings auth gate is healthy)", async ({
  page,
}) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
});

test("F6-smoke: /farms redirects unauthenticated users to /login (URL wired, not 404)", async ({
  page,
}) => {
  const response = await page.goto("/farms");
  // Next.js redirect + 200 (follows redirects by default)
  expect(response?.status()).toBe(200);
  // Should land on /login after the auth redirect
  expect(page.url()).toContain("/login");
});
