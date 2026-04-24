/**
 * __tests__/admin/reproduction-page-denorm.test.ts
 *
 * Guards Phase-I3 + I.4:
 *   I.3  — /admin/reproduction previously prefetched every animalId of the
 *          active species and pushed `{ animalId: { in: [...] } }` into every
 *          downstream repro-analytics query. The fix denormalises species onto
 *          Observation and filters on `species: mode` directly, eliminating
 *          the 874-ID IN-list.
 *   I.4  — The DaysOpenTable rendered one <tr> per animal unbounded. The fix
 *          caps the SSR slice; any full listing should use pagination.
 *
 * This is a parse-level guard — we assert the SSR source text does not
 * re-introduce the regressed patterns. Runtime SSR integration is covered
 * by `reproduction-analytics.test.ts` (for the helper) and by manual QA on
 * the rendered page.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const PAGE_PATH = join(
  REPO_ROOT,
  'app',
  '[farmSlug]',
  'admin',
  'reproduction',
  'page.tsx',
);
const HELPER_PATH = join(REPO_ROOT, 'lib', 'server', 'reproduction-analytics.ts');

async function readPage(): Promise<string> {
  return readFile(PAGE_PATH, 'utf-8');
}
async function readHelper(): Promise<string> {
  return readFile(HELPER_PATH, 'utf-8');
}

describe('reproduction page — species denormalisation (Phase-I3)', () => {
  it('does not pre-fetch a species animalId list via prisma.animal.findMany', async () => {
    const src = await readPage();
    // The previous regression shape:
    //   const speciesAnimalIds = ...
    //   const speciesAnimals = await prisma.animal.findMany({ where: { species: mode } ... })
    expect(src).not.toMatch(/speciesAnimalIds/);
    expect(src).not.toMatch(/speciesAnimals\s*=\s*await\s+prisma\.animal\.findMany/);
  });

  it('does not scope sub-queries via `animalId: { in: ... }`', async () => {
    const src = await readPage();
    // Any remaining repro query that narrows by animalId-IN defeats the
    // denormalisation. species is the scoping dimension now.
    expect(src).not.toMatch(/animalId\s*:\s*\{\s*in\s*:/);
  });

  it('passes the species mode directly into getReproStats', async () => {
    const src = await readPage();
    expect(src).toMatch(/getReproStats\([^)]*species\s*:\s*mode/);
  });

  it('scopes the recent-events query by species rather than animalId-IN', async () => {
    const src = await readPage();
    // The observation.findMany for `recentEvents` should filter on species.
    expect(src).toMatch(/species\s*:\s*mode/);
  });
});

describe('reproduction analytics helper — accepts species, not animalIds', () => {
  it('removes the `animalIds` option entirely', async () => {
    const src = await readHelper();
    // The public signature should no longer mention animalIds anywhere —
    // species is the single scoping dimension.
    expect(src).not.toMatch(/animalIds\s*\?\s*:\s*string\[\]/);
    expect(src).not.toMatch(/options\?\.\s*animalIds/);
  });

  it('accepts a `species` option', async () => {
    const src = await readHelper();
    expect(src).toMatch(/species\s*\?\s*:\s*string/);
  });

  it('does not prefetch animal IDs via prisma.animal.findMany', async () => {
    const src = await readHelper();
    expect(src).not.toMatch(/prisma\.animal\.findMany/);
  });
});

describe('DaysOpen table — SSR cap (Phase-I4)', () => {
  it('caps the SSR days-open slice via a `.slice(` or `take:` bound', async () => {
    const src = await readPage();
    // The Days Open per-animal table should not be unbounded. We accept
    // either an array .slice(0, N) on stats.daysOpen or a `take:` bound.
    const hasSlice = /stats\.daysOpen[\s\S]{0,200}?\.slice\(\s*0\s*,\s*\d+\s*\)/.test(src);
    const hasTake = /take\s*:\s*\d+/.test(src);
    expect(
      hasSlice || hasTake,
      'DaysOpenTable must cap its SSR payload (slice or take)',
    ).toBe(true);
  });
});
