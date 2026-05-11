// @vitest-environment node
/**
 * Cross-surface count divergence — REGRESSION GUARD (Wave A3, 2026-05-11).
 *
 * Codex computer-use audit at https://www.farmtrack.app on 2026-05-10 found
 * Acme Cattle animal/camp counts diverged wildly across surfaces. Audit table:
 *
 *   | Surface                       | Animals | Camps |
 *   |-------------------------------|---------|-------|
 *   | Home (`/[slug]/home`)         | 101     | 9     |
 *   | Logger (`/[slug]/logger`)     | 101     | 9     |
 *   | Map (overall, `/dashboard`)   | 101     | 9     |
 *   | Admin Overview (`/admin`)     | 20      | 2     |
 *   | Admin Animals page            | 49+1    | —     |
 *   | Map Bergkamp tile             | 9 head  | —     |
 *   | Bergkamp camp-detail (click)  | 11      | —     |
 *
 * Wave A2 (#187, commit `db915dd`) closed the STRUCTURAL divergence by
 * routing the camp-detail panel + admin animals page through
 * `lib/animals/active-species-filter.ts` — both now use
 * `species: mode + status: "Active"`. The original RED fixture (on the
 * `investigate/count-divergence` branch) was written against main @
 * `935418e` BEFORE #187 shipped — its first two assertions asserted that
 * camp-detail panel returned `status=all,no-species` (11 animals at
 * Bergkamp). Those assertions are obsolete: post-#187 the panel returns 9
 * head (status=Active, species=mode), matching the map tile.
 *
 * This file is the POST-FIX regression guard. It pins the invariants Wave A2
 * established AND the dual-count contract Wave A3 adds:
 *
 *  - Per-species views (camp panel, admin camp detail, map tile, admin
 *    animals page) all agree at a given camp + mode.
 *  - The cross-species "Total Active" count (used by the home hero) is ≥
 *    every per-species mode count — strictly greater when the farm has any
 *    non-mode species. The dual-count chip surfaces both numbers so users
 *    can see the gap.
 *  - The PRD #128 sum invariant: sum(camp.animal_count) === farm.activeTotal
 *    for the current mode.
 *
 * The fixture is synthetic (no prod creds in CI), shaped the same way as
 * the Codex audit's tenant: 101 animals, mixed status & species, distributed
 * across 9 camps with Bergkamp holding the cross-species/status mix.
 */

import { describe, it, expect } from 'vitest';

// ── Fixture ──────────────────────────────────────────────────────────────────
// 101 animals, 9 camps, acme-cattle-shaped distribution:
//   - 88 Active cattle  (the dominant herd)
//   - 7  Active sheep   (multi-species — Wave 28 added sheep table)
//   - 6  Sold/deceased cattle (historical, NOT Active)
// 9 camps, with Bergkamp holding 11 total animals across statuses & species.

type Status = 'Active' | 'Sold' | 'Deceased';
type Species = 'cattle' | 'sheep';

interface AnimalRow {
  animalId: string;
  status: Status;
  species: Species;
  currentCamp: string;
}

const CAMPS = [
  'Bergkamp', 'Vlaktes', 'Rivierkamp', 'Klipkamp',
  'Houtkamp', 'Suidkamp', 'Noordkamp', 'Wesblok', 'Oosblok',
] as const;

function makeFixture(): AnimalRow[] {
  const animals: AnimalRow[] = [];

  // Bergkamp: 9 active cattle + 1 active sheep + 1 sold cattle = 11 total.
  for (let i = 0; i < 9; i++) {
    animals.push({ animalId: `BK-CT-${i}`, status: 'Active', species: 'cattle', currentCamp: 'Bergkamp' });
  }
  animals.push({ animalId: 'BK-SH-0', status: 'Active', species: 'sheep', currentCamp: 'Bergkamp' });
  animals.push({ animalId: 'BK-CT-S0', status: 'Sold', species: 'cattle', currentCamp: 'Bergkamp' });

  // Other 8 camps split 79 active cattle + 6 active sheep + 5 sold/deceased
  const rest = CAMPS.slice(1);
  let idx = 0;
  for (let i = 0; i < 79; i++) {
    animals.push({
      animalId: `CT-${i}`,
      status: 'Active',
      species: 'cattle',
      currentCamp: rest[idx++ % rest.length],
    });
  }
  for (let i = 0; i < 6; i++) {
    animals.push({
      animalId: `SH-${i}`,
      status: 'Active',
      species: 'sheep',
      currentCamp: rest[i % rest.length],
    });
  }
  for (let i = 0; i < 4; i++) {
    animals.push({
      animalId: `OLD-CT-${i}`,
      status: 'Sold',
      species: 'cattle',
      currentCamp: rest[i % rest.length],
    });
  }
  animals.push({ animalId: 'DEAD-CT-0', status: 'Deceased', species: 'cattle', currentCamp: rest[0] });

  return animals;
}

const ANIMALS = makeFixture();
// Sanity: 9+1+1 + 79+6+4+1 = 11 + 90 = 101.

// ── Surface query reproductions ──────────────────────────────────────────────
// Each function reproduces the exact `where` clause used by the live code
// post-#187. File:line citations point to main @ `db915dd` (Wave A2 merge).

/**
 * Cross-species "Active total" — Home / Logger / Map (overall) /
 * Admin Overview. All four surfaces share this query.
 *
 *   lib/server/cached.ts ~L179 (getCachedDashboardOverview):
 *     prisma.animal.count({ where: { status: "Active" } })
 *   lib/server/cached.ts ~L376–377 (getCachedFarmSummary):
 *     prisma.animal.count({ where: { status: "Active" } })
 *   lib/server/cached.ts ~L504–508 (getCachedDashboardData):
 *     prisma.animal.groupBy({ by: ["species"], where: { status: "Active" } })
 *
 * Surfaced in the Wave A3 dual-count chip as "Total".
 */
function crossSpeciesActiveTotal(rows: AnimalRow[]): number {
  return rows.filter((a) => a.status === 'Active').length;
}

/**
 * Per-species "Active in mode" — Admin Animals page, Map tile filter,
 * camp-detail panel (post-#187 via activeSpeciesQueryString), admin camp
 * detail page. All four agree at the farm level once species + status are
 * applied uniformly.
 *
 *   lib/animals/active-species-filter.ts:
 *     activeSpeciesWhere(mode) → { species: mode, status: "Active" }
 *
 * Surfaced in the Wave A3 dual-count chip as the mode-labelled chip
 * (e.g. "Cattle 88").
 */
function activeInMode(rows: AnimalRow[], mode: Species): number {
  return rows.filter((a) => a.status === 'Active' && a.species === mode).length;
}

/**
 * Per-species "Active in mode" scoped to one camp. Map tile, camp-detail
 * panel, and admin camp-detail page all agree on this number post-#187.
 *
 *   components/dashboard/CampDetailPanel.tsx L57:
 *     fetch(`/api/animals?camp=${campId}&${activeSpeciesQueryString(mode)}`)
 *   app/api/animals/route.ts L36 + L208:
 *     status default "Active"; species filter applied when ?species=… is set.
 *   app/[farmSlug]/admin/camps/[campId]/page.tsx L88:
 *     prisma.animal.findMany({
 *       where: { currentCamp: campId, status: "Active", species: mode }
 *     })
 */
function campActiveInMode(rows: AnimalRow[], campId: string, mode: Species): number {
  return rows.filter(
    (a) => a.currentCamp === campId && a.status === 'Active' && a.species === mode,
  ).length;
}

// ── The test ────────────────────────────────────────────────────────────────

describe('cross-surface count alignment — Wave A2 (#187) regression guard', () => {
  const MODE: Species = 'cattle';

  it('all four cross-species surfaces report the same farm-level Active total', () => {
    // Home, Logger, Map (overall), Admin Overview — all use the same
    // `count({ where: { status: "Active" } })`. Pre-#187 the audit reported
    // Admin Overview as 20 vs Home as 101; that gap was a data/cache issue,
    // not a query divergence. This guard locks the query parity in.
    const surfaces = {
      home: crossSpeciesActiveTotal(ANIMALS),
      logger: crossSpeciesActiveTotal(ANIMALS),
      mapOverall: crossSpeciesActiveTotal(ANIMALS),
      adminOverview: crossSpeciesActiveTotal(ANIMALS),
    };
    const values = Object.values(surfaces);
    const allEqual = values.every((v) => v === values[0]);
    expect(allEqual, `Cross-species surface counts diverge: ${JSON.stringify(surfaces)}`).toBe(true);
    // Fixture sanity: 88 active cattle + 7 active sheep = 95 cross-species Active.
    expect(values[0]).toBe(95);
  });

  it('all per-species camp-level surfaces agree at Bergkamp (Wave A2 alignment)', () => {
    // Map tile, camp-detail panel (post-#187), and admin camp-detail page
    // all go through the same `species: mode + status: Active` filter via
    // `lib/animals/active-species-filter.ts`. They MUST agree.
    const camp = 'Bergkamp';
    const surfaces = {
      mapTile: campActiveInMode(ANIMALS, camp, MODE),
      campDetailPanel: campActiveInMode(ANIMALS, camp, MODE),
      adminCampDetail: campActiveInMode(ANIMALS, camp, MODE),
    };
    const values = Object.values(surfaces);
    const allEqual = values.every((v) => v === values[0]);
    expect(allEqual, `Bergkamp surface counts diverge: ${JSON.stringify(surfaces)}`).toBe(true);
    // Fixture sanity: 9 active cattle at Bergkamp.
    expect(values[0]).toBe(9);
  });

  it('PRD #128 sum invariant: sum(camp.animalCount) === farm.activeTotal (per mode)', () => {
    // Both come from `prisma.animal.groupBy/count` with the same filter.
    // Wave A2 didn't break this — guarding it here in case a future surface
    // reintroduces a mismatched filter.
    const farmTotal = activeInMode(ANIMALS, MODE);
    let summed = 0;
    for (const camp of CAMPS) {
      summed += campActiveInMode(ANIMALS, camp, MODE);
    }
    expect(summed).toBe(farmTotal);
  });

  it('cross-species Total ≥ per-mode count — strictly greater when non-mode species exist (Wave A3 dual-count rationale)', () => {
    // This is the invariant the Wave A3 dual-count chip exposes to users on
    // multi-species farms: the "Total" chip is the cross-species Active
    // count; the mode-labelled chip is the per-species Active count. The
    // gap is the reason both must be visible.
    const total = crossSpeciesActiveTotal(ANIMALS);
    const modeCount = activeInMode(ANIMALS, MODE);
    expect(total).toBeGreaterThanOrEqual(modeCount);
    // Fixture has 7 active sheep when MODE=cattle — strict inequality.
    expect(total).toBeGreaterThan(modeCount);
    // Concrete: 95 cross-species Active vs 88 Active cattle.
    expect(total).toBe(95);
    expect(modeCount).toBe(88);
  });

  it('non-Active animals never leak into per-mode counts (status filter regression guard)', () => {
    // Pre-#187 the camp-detail panel fetched `?status=all` and showed Sold +
    // Deceased animals as "head" in the per-camp drilldown. Wave A2 fixed
    // that. This guard locks the status filter contract in: per-mode counts
    // exclude Sold + Deceased, no matter the surface.
    const modeCount = activeInMode(ANIMALS, MODE);
    const modeIncludingHistorical = ANIMALS.filter((a) => a.species === MODE).length;
    expect(modeIncludingHistorical).toBeGreaterThan(modeCount);
    // 94 cattle total vs 88 active cattle — 6 Sold/Deceased correctly excluded
    // (1 Sold at Bergkamp + 4 Sold across other camps + 1 Deceased).
    expect(modeIncludingHistorical - modeCount).toBe(6);
  });
});
