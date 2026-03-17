# Full Reactivity Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mutation in the app (observations, animals, transactions, categories) immediately invalidates all relevant server-rendered pages so the next request always reflects current data; dashboard refreshes camp conditions every 10 seconds instead of 30.

**Architecture:** All Next.js API routes that write to the database will call `revalidatePath` for every page that displays that data. Dashboard client polling interval reduced from 30s to 10s. No new packages, no schema changes, no new files — surgical additions only.

**Tech Stack:** Next.js 16 App Router, `revalidatePath` from `next/cache`, Prisma 5 + Turso, Tailwind.

**App directory:** `/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management`

---

## Reactivity Matrix (what revalidates what)

| Mutation | Pages to revalidate |
|---|---|
| `observations` POST (logger sync, already partly done) | `/admin`, `/admin/observations`, **`/dashboard`** ← missing |
| `observations/[id]` PATCH (admin edit) | `/admin`, `/admin/observations` ← both missing |
| `animals` POST (already done) | `/admin`, `/admin/animals` ← covered |
| `animals/[id]` PATCH (admin edit) | `/admin`, `/admin/animals`, `/admin/animals/[id]` (page), `/dashboard` ← all missing |
| `transactions` POST | `/admin`, `/admin/finansies` ← both missing |
| `transactions/[id]` PATCH | `/admin`, `/admin/finansies` ← both missing |
| `transactions/[id]` DELETE | `/admin`, `/admin/finansies` ← both missing |
| `transaction-categories` POST | `/admin/finansies` ← missing |
| `transaction-categories/[id]` DELETE | `/admin/finansies` ← missing |

---

## Files Modified

| File | Change |
|---|---|
| `app/api/observations/route.ts` | Add `revalidatePath('/dashboard')` after existing revalidations |
| `app/api/observations/[id]/route.ts` | Add import + revalidatePath after update |
| `app/api/animals/[id]/route.ts` | Add import + revalidatePath after update |
| `app/api/transactions/route.ts` | Add import + revalidatePath after create |
| `app/api/transactions/[id]/route.ts` | Add import + revalidatePath after update and delete |
| `app/api/transaction-categories/route.ts` | Add import + revalidatePath after create |
| `app/api/transaction-categories/[id]/route.ts` | Add import + revalidatePath after delete |
| `components/dashboard/DashboardClient.tsx` | Change poll interval `30_000` → `10_000` |

No new files. No schema changes. No route changes.

---

## Task 1 — observations POST: add `/dashboard` revalidation

**File:** `app/api/observations/route.ts`

Currently line 74–75:
```ts
revalidatePath('/admin');
revalidatePath('/admin/observations');
```

- [ ] Add `revalidatePath('/dashboard')` immediately after line 75 (before the `return`)

Result after change (lines 74–77):
```ts
revalidatePath('/admin');
revalidatePath('/admin/observations');
revalidatePath('/dashboard');
return NextResponse.json({ success: true, id: record.id });
```

No import change needed — `revalidatePath` is already imported at line 5.

---

## Task 2 — observations/[id] PATCH: add full revalidation

**File:** `app/api/observations/[id]/route.ts`

Currently has no `revalidatePath` import or calls. After `prisma.observation.update` succeeds (the `const updated = await ...` line), add revalidations before `return NextResponse.json(updated)`.

- [ ] Add import at top of file (after existing imports):
```ts
import { revalidatePath } from 'next/cache';
```

- [ ] After `const updated = await prisma.observation.update(...)`, add before return:
```ts
revalidatePath('/admin');
revalidatePath('/admin/observations');
```

Result:
```ts
const updated = await prisma.observation.update({ ... });

revalidatePath('/admin');
revalidatePath('/admin/observations');
return NextResponse.json(updated);
```

---

## Task 3 — animals/[id] PATCH: add full revalidation

**File:** `app/api/animals/[id]/route.ts`

Currently has no `revalidatePath` import or calls. After `prisma.animal.update` succeeds, add revalidations.

- [ ] Add import at top of file (after existing imports):
```ts
import { revalidatePath } from 'next/cache';
```

- [ ] After `const animal = await prisma.animal.update(...)`, add before return:
```ts
revalidatePath('/admin');
revalidatePath('/admin/animals');
revalidatePath('/admin/animals/[id]', 'page');
revalidatePath('/dashboard');
```

Result:
```ts
const animal = await prisma.animal.update({ ... });

revalidatePath('/admin');
revalidatePath('/admin/animals');
revalidatePath('/admin/animals/[id]', 'page');
revalidatePath('/dashboard');
return NextResponse.json(animal);
```

---

## Task 4 — transactions POST: add revalidation

**File:** `app/api/transactions/route.ts`

Currently has no `revalidatePath` import or calls. After `prisma.transaction.create` succeeds:

- [ ] Add import at top of file (after existing imports):
```ts
import { revalidatePath } from 'next/cache';
```

- [ ] After `const transaction = await prisma.transaction.create(...)`, add before return:
```ts
revalidatePath('/admin');
revalidatePath('/admin/finansies');
```

Result:
```ts
const transaction = await prisma.transaction.create({ ... });

revalidatePath('/admin');
revalidatePath('/admin/finansies');
return NextResponse.json(transaction, { status: 201 });
```

---

## Task 5 — transactions/[id] PATCH and DELETE: add revalidation

**File:** `app/api/transactions/[id]/route.ts`

Currently has no `revalidatePath` import or calls. Has both a PATCH and a DELETE handler.

- [ ] Add import at top of file (after existing imports):
```ts
import { revalidatePath } from 'next/cache';
```

- [ ] In PATCH handler, after `const transaction = await prisma.transaction.update(...)`, add before return:
```ts
revalidatePath('/admin');
revalidatePath('/admin/finansies');
```

- [ ] In DELETE handler, after `await prisma.transaction.delete(...)`, add before return:
```ts
revalidatePath('/admin');
revalidatePath('/admin/finansies');
```

Result (PATCH):
```ts
const transaction = await prisma.transaction.update({ ... });
revalidatePath('/admin');
revalidatePath('/admin/finansies');
return NextResponse.json(transaction);
```

Result (DELETE):
```ts
await prisma.transaction.delete({ where: { id } });
revalidatePath('/admin');
revalidatePath('/admin/finansies');
return NextResponse.json({ ok: true });
```

---

## Task 6 — transaction-categories POST: add revalidation

**File:** `app/api/transaction-categories/route.ts`

Currently has no `revalidatePath` import or calls. After `prisma.transactionCategory.create` succeeds:

- [ ] Add import at top of file (after existing imports):
```ts
import { revalidatePath } from 'next/cache';
```

- [ ] After `const category = await prisma.transactionCategory.create(...)`, add before return:
```ts
revalidatePath('/admin/finansies');
```

Result:
```ts
const category = await prisma.transactionCategory.create({ ... });
revalidatePath('/admin/finansies');
return NextResponse.json(category, { status: 201 });
```

---

## Task 7 — transaction-categories/[id] DELETE: add revalidation

**File:** `app/api/transaction-categories/[id]/route.ts`

Currently has no `revalidatePath` import or calls. After `prisma.transactionCategory.delete` succeeds:

- [ ] Add import at top of file (after existing imports):
```ts
import { revalidatePath } from 'next/cache';
```

- [ ] After `await prisma.transactionCategory.delete({ where: { id } })`, add before return:
```ts
revalidatePath('/admin/finansies');
```

Result:
```ts
await prisma.transactionCategory.delete({ where: { id } });
revalidatePath('/admin/finansies');
return NextResponse.json({ ok: true });
```

---

## Task 8 — Reduce dashboard poll interval from 30s to 10s

**File:** `components/dashboard/DashboardClient.tsx`

Around line 169:
```ts
const interval = setInterval(fetchConditions, 30_000);
```

- [ ] Change `30_000` to `10_000`:
```ts
const interval = setInterval(fetchConditions, 10_000);
```

---

## Task 9 — Verify: pnpm build --webpack

- [ ] Run from app directory:
```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
pnpm build --webpack 2>&1 | tail -40
```
Expected: zero errors, all routes show `ƒ` (dynamic).
