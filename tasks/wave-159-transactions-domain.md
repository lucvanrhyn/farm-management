# Wave D — Transactions domain extraction (#159)

ADR-0001 rollout, fourth wave. Copies Wave C structure (PR #157) for the transactions surface. Tracker: [#159](https://github.com/lucvanrhyn/farm-management/issues/159).

## Why

The transactions route handlers (`/api/transactions/**`) are the last finance-adjacent CRUD surface still hand-rolled with inline auth, body-parse, and untyped 400 strings. Migrating them onto Wave A's `tenantRead` / `tenantWrite` / `adminWrite` adapters with a `lib/domain/transactions/*` op layer:

1. Closes another quarter of the ADR-0001 surface (4 of ~8 areas now adapter-wrapped — camps/animals · mobs · observations · transactions).
2. Locks the P0.1-class bug (stale Prisma client throw → empty 500) out of one more route tree by routing every error through the `mapApiDomainError` envelope.
3. Migrates four free-text 400 messages to typed wire codes (`VALIDATION_FAILED` / `INVALID_SALE_TYPE` / `INVALID_DATE_FORMAT` / `TRANSACTION_NOT_FOUND`), consistent with Waves B+C precedent.

## Scope (file allow-list — do not edit outside)

### New files

```
lib/domain/transactions/list-transactions.ts
lib/domain/transactions/create-transaction.ts
lib/domain/transactions/update-transaction.ts
lib/domain/transactions/delete-transaction.ts
lib/domain/transactions/reset-transactions.ts
lib/domain/transactions/errors.ts
lib/domain/transactions/index.ts
lib/domain/transactions/__tests__/list-transactions.test.ts
lib/domain/transactions/__tests__/create-transaction.test.ts
lib/domain/transactions/__tests__/update-transaction.test.ts
lib/domain/transactions/__tests__/delete-transaction.test.ts
lib/domain/transactions/__tests__/reset-transactions.test.ts
tasks/wave-159-transactions-domain.md   # this file
```

### Modified

```
app/api/transactions/route.ts
app/api/transactions/[id]/route.ts
app/api/transactions/reset/route.ts
lib/server/api-errors.ts
__tests__/api/route-handler-coverage.test.ts
.audit-findmany-baseline.json
.audit-findmany-no-select-baseline.json
```

### Out of scope (deferred to later waves)

- `app/api/transaction-categories/**` → Wave D2 (FK-coupled but separate entity)
- `app/api/[farmSlug]/transactions/route.ts` → Wave G
- `lib/server/financial-analytics.ts`, `lib/server/profitability-by-animal.ts`, `lib/server/sars-it3.ts`, `lib/server/export/transactions.ts` → analytics-layer pass
- `app/api/[farmSlug]/budgets/**` → Wave G
- `components/admin/finansies/**` UI consumers — wire shape stays back-compat, no UI churn

## Wire-shape contract

### Preserved (back-compat — admin UI + offline sync depend on these)

- `GET /api/transactions` → 200 `Transaction[]` (raw Prisma rows)
- `POST /api/transactions` → 201 `Transaction` (raw row)
- `PATCH /api/transactions/[id]` → 200 `Transaction` (raw row)
- `DELETE /api/transactions/[id]` → 200 `{ ok: true }`
- `DELETE /api/transactions/reset` → 200 `{ success: true }`

### Refined (free-text → typed code, mirrors Wave C)

| Old wire | New wire | Status |
|---|---|---|
| `400 { error: "type, category, amount, date required" }` | `400 { error: "VALIDATION_FAILED", message, details: { fieldErrors } }` | 400 (RouteValidationError via tenantWrite/adminWrite schema) |
| `400 { error: "saleType must be 'auction' or 'private'" }` | `422 { error: "INVALID_SALE_TYPE" }` | 422 (typed business rule) |
| `400 { error: "from must be YYYY-MM-DD" }` / `to must be YYYY-MM-DD` | `400 { error: "INVALID_DATE_FORMAT", details: { field } }` | 400 |
| `404 { error: "Transaction not found" }` | `404 { error: "TRANSACTION_NOT_FOUND" }` | 404 |
| `401 { error: "Unauthorized" }` | preserved (adapter-emitted) | 401 |
| `403 { error: "Forbidden" }` | preserved (adapter-emitted, including stale-ADMIN re-verify) | 403 |

## Domain ops contract

All ops are pure `(prisma, input) => Promise<output>` — adapters supply the tenant-scoped Prisma client, ops own validation + business rules + Prisma calls.

```ts
// list-transactions.ts
export interface ListTransactionsFilters {
  type?: string | null;
  category?: string | null;
  from?: string | null;
  to?: string | null;
}
export async function listTransactions(prisma, filters): Promise<Transaction[]>
// Throws InvalidDateFormatError if from/to fail YYYY-MM-DD regex.

// create-transaction.ts
export interface CreateTransactionInput { /* full body shape */ }
export async function createTransaction(prisma, input): Promise<Transaction>
// Throws InvalidSaleTypeError on bad saleType.
// RouteValidationError thrown at the route layer for missing required fields
// (so the 400 envelope contract matches Wave C).

// update-transaction.ts
export interface UpdateTransactionInput { /* partial body */ }
export async function updateTransaction(prisma, id, input): Promise<Transaction>
// Throws TransactionNotFoundError if id missing, InvalidSaleTypeError on bad saleType.

// delete-transaction.ts
export async function deleteTransaction(prisma, id): Promise<{ ok: true }>
// Throws TransactionNotFoundError if id missing.

// reset-transactions.ts
export async function resetTransactions(prisma): Promise<{ success: true; count: number }>
// Note: resets BOTH Transaction AND TransactionCategory tables (matches current behaviour).
// TransactionCategory mass-delete stays here even though categories are otherwise Wave-D2 scope —
// the route currently does both atomically, do not split.
```

### Errors module (`lib/domain/transactions/errors.ts`)

```ts
export const TRANSACTION_NOT_FOUND = "TRANSACTION_NOT_FOUND" as const;
export const INVALID_SALE_TYPE = "INVALID_SALE_TYPE" as const;
export const INVALID_DATE_FORMAT = "INVALID_DATE_FORMAT" as const;

export class TransactionNotFoundError extends Error { /* code: TRANSACTION_NOT_FOUND */ }
export class InvalidSaleTypeError extends Error { /* code: INVALID_SALE_TYPE; received: string */ }
export class InvalidDateFormatError extends Error { /* code: INVALID_DATE_FORMAT; field: "from" | "to" */ }
```

### `lib/server/api-errors.ts` extension

Append to `mapApiDomainError`:

```ts
import {
  InvalidDateFormatError,
  InvalidSaleTypeError,
  TransactionNotFoundError,
} from "@/lib/domain/transactions/errors";

if (err instanceof TransactionNotFoundError) {
  return NextResponse.json({ error: err.code }, { status: 404 });
}
if (err instanceof InvalidSaleTypeError) {
  return NextResponse.json({ error: err.code }, { status: 422 });
}
if (err instanceof InvalidDateFormatError) {
  return NextResponse.json(
    { error: err.code, details: { field: err.field } },
    { status: 400 },
  );
}
```

## Audit baseline path swap (NOT new exemption)

Per `feedback-soak-applies-to-all-promotes.md` and Wave B's lesson — when a grandfathered findMany MOVES, swap the path; do not add new entry.

`.audit-findmany-baseline.json` and `.audit-findmany-no-select-baseline.json`:

- Replace: `app/api/transactions/route.ts::transaction::0`
- With:    `lib/domain/transactions/list-transactions.ts::transaction::0`

Leave the other two transaction entries (`[farmSlug]/transactions/route.ts::transaction::0` and `lib/server/export/transactions.ts::transaction::0`) untouched — out of scope.

## Route-handler-coverage EXEMPT pruning

`__tests__/api/route-handler-coverage.test.ts` — remove these three lines (currently 129-131):

```
"transactions/[id]/route.ts",
"transactions/reset/route.ts",
"transactions/route.ts",
```

Keep `transaction-categories/[id]/route.ts` and `transaction-categories/route.ts` (Wave D2).
Keep `[farmSlug]/transactions/route.ts` (Wave G).

## TDD discipline

For each domain op:

1. **RED** — write failing vitest with mocked Prisma asserting the wire-shape contract.
2. **GREEN** — implement minimum to pass.
3. **REFACTOR** — pull constants/helpers if duplication appears.

Then for routes:

4. Rewrite each route file as adapter wiring (schema parse + adapter call only — no inline auth, no inline try/catch).
5. Re-run `__tests__/api/route-handler-coverage.test.ts` and the existing `__tests__/server/transaction-is-foreign.test.ts` + `__tests__/admin/finansies-page-pagination.test.tsx` — they must still pass.

## 8-gate verify (must all be green before push)

```bash
pnpm build --webpack
pnpm lint
pnpm vitest run
npx tsc --noEmit
pnpm audit-findmany:ci
pnpm audit-findmany-no-select:ci
```

Plus:

- `__tests__/api/route-handler-coverage.test.ts` green with 3 fewer EXEMPT entries.
- All transaction-touching tests still green:
  - `__tests__/server/transaction-is-foreign.test.ts`
  - `__tests__/admin/finansies-page-pagination.test.tsx`

## Definition of done

- All 8 gates green.
- Diff scoped strictly to allow-list above.
- PR opened referencing #159; `gate` + `require` + `audit-bundle` + `lhci-cold` + `audit-pagination` SUCCESS.
- Soak gate (`require=SUCCESS` for latest SHA) cleared before promote.
