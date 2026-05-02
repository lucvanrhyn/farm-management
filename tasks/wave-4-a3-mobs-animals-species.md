# Wave 4 A3 — `/api/mobs/[mobId]/animals` species filter + actual count

Source: Codex adversarial review 2026-05-02 (HIGH).

## Bugs

1. **Species bypass (POST):** `prisma.animal.updateMany({ where: { animalId: { in }, status: "Active" }, ... })` does not filter on `species`. A user can drop sheep into a cattle mob silently. Spec [`multi-species-spec-2026-04-27.md`] requires hard-block of cross-species moves.
2. **Requested-vs-actual count (POST + DELETE):** the response reports `body.animalIds.length` even when some IDs were rejected by the where clause (wrong species, wrong status, doesn't exist). Hides cross-species attempts.

## Response shape decision

Keep backwards compatibility: `count` continues to be the **actual** number of rows affected. Add optional `requested` and `mismatched` fields when there is a delta so UIs can surface a warning. No 422 — partial success is the right contract for "assign these animals to this mob": if 5 of 6 succeed, 1 was wrong-species/wrong-status, the caller should still see the 5 succeeded and a `mismatched: 1` count.

Existing caller (`components/admin/MobsManager.tsx`) only checks `res.ok` and ignores the response body, so `count`'s semantics change is safe — old callers see `count` shrink to match reality, which is more correct than the previous over-count.

## Plan

- [x] Worktree set up
- [x] Read existing route, callers, related cross-species tests
- [x] Write failing tests `__tests__/api/mobs-animals-species.test.ts`
- [x] Implement species filter + actual count (POST + DELETE)
- [x] `pnpm vitest run __tests__/api/mobs-animals-species.test.ts`
- [x] `pnpm lint && pnpm tsc`
- [x] `pnpm build --webpack`
- [x] Commit + push + open PR
- [ ] Wait ≥1h soak before merge

## Files touched

- `app/api/mobs/[mobId]/animals/route.ts` — primary fix
- `__tests__/api/mobs-animals-species.test.ts` — new
- `tasks/wave-4-a3-mobs-animals-species.md` — this checklist
