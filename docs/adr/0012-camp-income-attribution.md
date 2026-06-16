# Per-camp profitability: attribute sale income to the animal's last camp

**Status:** accepted (2026-06-14)

## Context

Profit-Per-Camp (quick win #4) rolls FarmTrack's existing finance layer up to
the camp level. Cost attribution per camp already exists: `Transaction.campId`
tags camp-level costs, and `calcProfitabilityByAnimal` allocates camp-tagged
costs across the animals in that camp; `getCostPerCamp` and `CogByCampRow`
already report cost and cost-of-gain per camp.

The missing half is **income**. A sale `Transaction` is tagged to `animalId`
(or `animalIds[]` for a batch), **not** to a `campId` — and an animal moves
through many camps in its life. To compute `profit(camp) = income − cost`, we
need a rule for which camp a sale's income belongs to.

Options:

1. **Last camp** — credit income to the animal's `currentCamp` at sale time.
2. **campId-only** — count only transactions carrying an explicit `campId`.
3. **Cost-only** — don't attribute income per camp; keep profit at
   animal/category/farm level.

## Decision

Adopt **(1) last-camp attribution.** A sale's income is credited to the camp
the sold animal was in at sale time (its `currentCamp` / last camp before the
animal left Active status). For a batch sale, each animal's share of the
proceeds credits its own last camp.

- **Costs** keep their existing attribution (`campId`, or camp-tagged costs
  allocated across the camp's animals).
- **Unallocated finance** (transactions with neither `animalId` nor `campId` —
  farm overhead) is shown as a separate line and **never spread** across camps.
- **Normalisation**: report `profit ÷ LSU` (merged-LSU) and `÷ sizeHectares`
  alongside the rand figure.
- The farm-level P&L (`getFinancialKPIs`) stays the authoritative total; camp
  profitability is a reporting view, not a second ledger.

## Why last-camp

"Where it was finished" is how graziers reason about camp performance — the
finishing camp did the final value-add. It reuses `currentCamp`, already on
every `Animal`, so no new data capture. It is symmetric with the existing cost
allocation (camp-tagged costs already land on the current occupants).

## Why not campId-only or cost-only

campId-only leaves most camps empty of income (sales are animal-tagged), making
per-camp profit misleading. Cost-only is honest but delivers "cost per camp,"
not the money-clarity "which camp makes money" story the feature exists for.

## Known limitation

An animal moved to a dedicated **sale/holding camp** immediately before sale
credits its income to that holding camp, understating the production camp that
actually grew it. v1 accepts this; a future refinement may credit the last
*production* camp (the prior camp when the last camp is flagged
holding/sale-yard). Documented in CONTEXT.md so the number is not mistaken for
accounting truth.

## Why an ADR

The attribution rule determines every per-camp profit figure the product
reports; changing it later silently restates historical numbers users may have
acted on. It is also non-obvious — a reader seeing a sale credited to one camp
when the animal grazed five will ask why. Pinning it here makes the choice and
its limitation explicit.

## Rollout

Single TDD wave `wave/profit-per-camp-v1` when build resumes. Order: income
last-camp attribution + batch split (table tests) → per-camp profit roll-up
(income − cost) reusing `getCostPerCamp` / `calcProfitabilityByAnimal` →
per-LSU / per-ha normalisation → unallocated line → profitability screen →
optional Einstein narration.
