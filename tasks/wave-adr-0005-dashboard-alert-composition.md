# Wave — Dashboard alert composition core (ADR-0005)

Closes #306. Implements `docs/adr/0005-dashboard-alert-composition.md`.

## Goal

Split `lib/server/dashboard-alerts.ts` into a pure `composeAlerts` core +
a thin `getDashboardAlerts` fetch shell, add a fence alert type, migrate
the `DashboardClient` header badge to consume the same core via a partial
pass, and lock the monotonicity invariant with an architecture test. After
this wave there is exactly one definition of "what counts as an alert."

## Target

- Branch: `wave/306-dash-alert-compose` off `main` (per
  CLAUDE.md §branching-workflow). Worktree:
  `.worktrees/dash-alert-compose` (already created, tracks origin/main).
- One TDD agent. File allow-list below. No file outside it.

## File allow-list

- `lib/server/dashboard-alerts.ts` (split; shell + re-export)
- `lib/server/alerts/compose.ts` (new — pure core, only if the shell would
  otherwise exceed ~400 lines; otherwise keep `composeAlerts` exported
  from `dashboard-alerts.ts`)
- `lib/server/alerts/__tests__/compose.test.ts` (new — table tests)
- `lib/server/alerts/__tests__/compose-monotonicity.test.ts` (new —
  property/invariant test)
- `components/dashboard/DashboardClient.tsx` (delete bespoke formulas,
  call `composeAlerts`)
- `components/dashboard/__tests__/dashboard-client-alert-count.test.tsx`
  (new — header uses partial pass, asserts ⊆ full)
- `docs/adr/0005-dashboard-alert-composition.md` (already written)
- `CONTEXT.md` (Alerts section — already written)

Out of allow-list, do not touch: the five `getDashboardAlerts` callers
(`app/[farmSlug]/admin/alerts/page.tsx`, `lib/server/cached.ts`,
`lib/server/notification-generator.ts`,
`lib/server/alerts/legacy-dashboard.ts`). Signature is preserved; they are
regression-guarded by their existing integration coverage.

## Interface contract

```ts
export interface AlertInputs {
  // independently-optional sources — absent = contributes nothing
  campConditions?: Map<string, LiveCampStatus>;
  totalCamps?: number;
  withdrawalAnimals?: { /* shape from getAnimalsInWithdrawal */ }[];
  rotationPayload?: RotationStatusPayload | null;
  veldSummary?: VeldFarmSummary | null;
  feedOnOfferPayload?: FeedOnOfferPayload | null;
  droughtPayload?: DroughtPayload | null;
  speciesAlerts?: DashboardAlert[];
  // required config
  thresholds: AlertThresholds;
  farmSlug: string;
  now: Date;
}

export function composeAlerts(inputs: AlertInputs): DashboardAlerts;
```

`getDashboardAlerts(prisma, farmSlug, thresholds, preFetched?, mode?)`
keeps its exact signature: fetch the eight sources (unchanged
`Promise.all`), then `return composeAlerts({...fetched, thresholds,
farmSlug, now})`. The `mode` species-narrowing stays in the shell (it
filters `speciesAlerts` before passing them in).

## TDD sequence (red → green → refactor, one step at a time)

1. **RED — table tests for the existing behaviour.** Write
   `compose.test.ts` against the not-yet-extracted `composeAlerts`: one
   case per alert type (poor-grazing, stale-inspection, withdrawal,
   rotation overstayed/overdue, veld critical/declining/overdue,
   feed-on-offer critical/low/stale, drought severe/moderate,
   species-alert passthrough red/amber). Assert exact `red`/`amber` ids,
   counts, `totalCount`. Tests fail to compile (no `composeAlerts` yet).

2. **GREEN — extract the pure core.** Lift lines ~172–421 of
   `dashboard-alerts.ts` verbatim into `composeAlerts(inputs)`. Rewrite
   `getDashboardAlerts` as: fetch → `composeAlerts`. Behaviour change:
   zero. Table tests from step 1 go green. Run the five callers'
   existing integration tests — must stay green (signature unchanged).

3. **RED — fence alert.** Add a `compose.test.ts` case: a
   `campConditions` entry with `fence_status !== "Intact"` must emit an
   amber farm-wide alert id `fence-damaged` (or similar), pluralised,
   `href` to camps. Fails (no fence alert in engine yet).

4. **GREEN — fence alert.** Add the fence branch to `composeAlerts`
   alongside poor-grazing (same camp-conditions loop). Step 3 green.
   Update the relevant table-test totals.

5. **RED — header partial pass.** Write
   `dashboard-client-alert-count.test.tsx`: render `DashboardClient`
   with a `liveConditions` fixture; assert the header count equals
   `composeAlerts({ campConditions: <adapted>, totalCamps, thresholds,
   farmSlug, now }).totalCount` — and that this is ≤ the full-pass count
   for the same farm fixture. Fails (header still uses bespoke formula).

6. **GREEN — migrate `DashboardClient`.** Delete the
   `grazing_quality === "Poor" || fence_status !== "Intact"` formula and
   the bespoke `inspectedToday` filter (lines ~267–274). Add a
   `liveConditions → Map<string, LiveCampStatus>` adapter (pin the
   field mapping in one helper). Compute `alertCount`/`inspectedToday`
   from `composeAlerts`. Step 5 green.

7. **REFACTOR + LOCK — monotonicity invariant.** Write
   `compose-monotonicity.test.ts`: generate input bags, assert for every
   (subset ⊆ superset) of present sources that
   `composeAlerts(subset)` ids ⊆ `composeAlerts(superset)` ids and
   `subset.totalCount <= superset.totalCount`. This is the structural
   guardrail (mirrors `sync-truth-no-direct-callers.test.ts`). Tidy the
   shell; ensure no dead `preFetched`/`reproStats` paths regressed.

## Verification before promote (CLAUDE.md §verify-before-promote)

- `npx tsc --noEmit` (after `rm -rf .next/cache/tsbuildinfo .tsbuildinfo`).
- `pnpm vitest run lib/server/alerts components/dashboard` — all green.
- Existing caller suites green (notification-generator,
  cached, legacy-dashboard, alerts page).
- `pnpm build --webpack` green.
- Manual: load `/admin` and `/admin/alerts` for a seeded multi-species
  farm; header count ≤ alerts-page count, fence-damaged camp appears in
  both. Verify offline (DevTools offline) the header still renders a
  number from cached conditions.
- Re-audit diff: five callers untouched, no dead code, fence alert
  href/icon consistent with sibling camp alerts.

## Done = ADR-0005 satisfied

One definition of an Alert. Header is a provable prefix of the canonical
set. The composition engine is table- and property-tested. The divergence
class is structurally locked out.
