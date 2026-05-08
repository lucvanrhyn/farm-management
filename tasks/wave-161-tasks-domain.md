# Wave E — Tasks domain extraction (#161)

ADR-0001 rollout, fifth wave. Copies Wave D structure (PR #160) for the tasks core surface. Tracker: [#161](https://github.com/lucvanrhyn/farm-management/issues/161).

## Why

The `app/api/tasks/**` core route handlers are the most complex CRUD surface still hand-rolled with inline auth, body-parse, and untyped 400 strings. Migrating them onto Wave A's `tenantRead` / `adminWrite` adapters with a `lib/domain/tasks/*` op layer:

1. Closes another quarter of the ADR-0001 surface (5 of ~8 areas now adapter-wrapped — camps/animals · mobs · observations · transactions · tasks).
2. Locks the P0.1-class bug (stale Prisma client throw → empty 500) out of one more route tree by routing every error through the `mapApiDomainError` envelope.
3. Migrates five free-text 400 messages to typed wire codes (`VALIDATION_FAILED` / `INVALID_LIMIT` / `INVALID_CURSOR` / `TASK_NOT_FOUND` / preserves the existing `INVALID_RECURRENCE_RULE` and `TEMPLATE_NOT_FOUND` codes).
4. Pulls the Phase K observation-on-completion `$transaction` into the domain layer where it can be unit-tested in isolation against a mocked Prisma — currently it sits inline in the route, only exercised through `task-completion-flow.test.ts`.

## Scope (file allow-list — do not edit outside)

### New files

```
lib/domain/tasks/list-tasks.ts
lib/domain/tasks/create-task.ts
lib/domain/tasks/update-task.ts
lib/domain/tasks/delete-task.ts
lib/domain/tasks/errors.ts
lib/domain/tasks/index.ts
lib/domain/tasks/__tests__/list-tasks.test.ts
lib/domain/tasks/__tests__/create-task.test.ts
lib/domain/tasks/__tests__/update-task.test.ts
lib/domain/tasks/__tests__/delete-task.test.ts
tasks/wave-161-tasks-domain.md   # this file
```

### Modified

```
app/api/tasks/route.ts
app/api/tasks/[id]/route.ts
lib/server/api-errors.ts
__tests__/api/route-handler-coverage.test.ts
.audit-findmany-baseline.json
.audit-findmany-no-select-baseline.json
```

### Out of scope (deferred to later waves)

- `app/api/task-occurrences/route.ts` → **Wave E2** (read-only; trivial but separate entity)
- `app/api/task-templates/install/route.ts` → **Wave E2**
- `app/api/task-templates/[id]/route.ts` → **Wave E2**
- `app/api/[farmSlug]/map/task-pins/route.ts` → **Wave G**
- `app/api/farm-settings/tasks/route.ts` → **Wave G**
- `lib/server/inngest/tasks.ts`, `lib/server/inngest/einstein.ts` → analytics-layer pass

## Wire-shape contract

### Preserved (back-compat — admin UI + offline sync depend on these)

- `GET /api/tasks` (no params)             → 200 `Task[]` with parsed `assigneeIds` + `blockedByIds` arrays
- `GET /api/tasks?limit=N` / `?cursor=X`    → 200 `{ tasks: Task[], nextCursor: string|null, hasMore: boolean }`
- `GET /api/tasks?as=occurrences&from&to`   → 200 `TaskOccurrence[]` (with included `task`)
- `POST /api/tasks` → 201 `Task` (ADMIN-only)
- `PATCH /api/tasks/[id]` → 200 `Task & { observationCreated: boolean, observationId?: string }` (ADMIN-only)
- `DELETE /api/tasks/[id]` → 200 `{ success: true }` (ADMIN-only)

### Refined (free-text → typed code, mirrors Wave D)

| Old wire | New wire | Status |
|---|---|---|
| `400 { error: "Invalid limit" }` | `400 { error: "INVALID_LIMIT" }` | 400 |
| `400 { error: "Invalid cursor" }` | `400 { error: "INVALID_CURSOR" }` | 400 |
| `400 { error: "title is required" }` etc. | `400 { error: "VALIDATION_FAILED", message, details: { fieldErrors } }` | 400 (RouteValidationError via adminWrite schema) |
| `400 { error: "Invalid JSON body" }` | preserved (adapter-emitted) | 400 |
| `400 { error: "Invalid recurrence rule", code: "INVALID_RECURRENCE_RULE" }` | `400 { error: "INVALID_RECURRENCE_RULE" }` | 400 (drop the human prefix; preserve the code) |
| `400 { error: "Template not found", code: "TEMPLATE_NOT_FOUND" }` | `400 { error: "TEMPLATE_NOT_FOUND" }` | 400 (preserve existing 400 status — NOT a 404; matches current contract) |
| `404 { error: "Task not found" }` | `404 { error: "TASK_NOT_FOUND" }` | 404 |
| `401 { error: "Unauthorized" }` | preserved (adapter-emitted) | 401 |
| `403 { error: "Forbidden" }` | preserved (adapter-emitted, including stale-ADMIN re-verify) | 403 |

**IMPORTANT — TEMPLATE_NOT_FOUND stays 400, not 404.** The current route returns 400 because it's treated as an invalid input error (you supplied a bad templateId), not a missing resource. Do not "fix" this to 404 — wire-shape change risk for offline-sync clients that may already be coding against 400.

## Domain ops contract

All ops are pure `(prisma, input) => Promise<output>` — adapters supply the tenant-scoped Prisma client, ops own validation + business rules + Prisma calls.

```ts
// list-tasks.ts
export type ListMode = "occurrences" | "paginated" | "unbounded";
export interface ListTasksFilters {
  assignee?: string | null;
  status?: string | null;        // comma-separated → splits inside op
  date?: string | null;
  campId?: string | null;
  taskType?: string | null;
  geo?: { lat: number; lng: number; radiusKm: number } | null;
}
export interface ListTasksOccurrencesArgs {
  from: Date;
  to: Date;
}
export interface ListTasksPaginatedArgs {
  filters: ListTasksFilters;
  limit: number;
  cursor?: string | null;
}
// Three exported functions to keep the mode dispatch type-safe at the call site:
export async function listTasksUnbounded(prisma, filters): Promise<ParsedTask[]>
export async function listTasksPaginated(prisma, args): Promise<{ tasks: ParsedTask[]; nextCursor: string | null; hasMore: boolean }>
// Throws InvalidLimitError if limit ≤ 0 / NaN; InvalidCursorError if cursor decode fails.
export async function listTaskOccurrences(prisma, args): Promise<TaskOccurrenceWithTask[]>

// create-task.ts
export interface CreateTaskInput {
  title: string;
  dueDate: string;
  assignedTo: string;
  description?: string;
  status?: string;
  priority?: string;
  campId?: string;
  animalId?: string;
  taskType?: string;
  lat?: number;
  lng?: number;
  recurrenceRule?: string;
  reminderOffset?: number;
  assigneeIds?: string[];
  templateId?: string;
  blockedByIds?: string[];
  recurrenceSource?: string;
  createdBy: string; // adapter passes session.user email/name
}
export async function createTask(prisma, input): Promise<ParsedTask>
// Throws InvalidRecurrenceRuleError on bad recurrenceRule; TemplateNotFoundError on bad templateId.
// RouteValidationError thrown at the route layer for missing required fields.

// update-task.ts
export interface UpdateTaskInput { /* partial body, allow-list */ }
export interface CompletionPayloadInput { /* TaskCompletionPayload */ }
export async function updateTask(prisma, id, input, completionPayload?): Promise<ParsedTask & { observationCreated: boolean; observationId?: string }>
// Throws TaskNotFoundError if id missing.
// On status flip → "completed" + valid completionPayload: runs observationFromTaskCompletion;
// if non-null, creates Observation + updates Task in $transaction with denormalised species lookup.
// Identical semantics to current PATCH route.

// delete-task.ts
export async function deleteTask(prisma, id): Promise<{ success: true }>
// Throws TaskNotFoundError if id missing.
```

### Errors module (`lib/domain/tasks/errors.ts`)

```ts
export const TASK_NOT_FOUND = "TASK_NOT_FOUND" as const;
export const INVALID_RECURRENCE_RULE = "INVALID_RECURRENCE_RULE" as const;
export const TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND" as const;
export const INVALID_LIMIT = "INVALID_LIMIT" as const;
export const INVALID_CURSOR = "INVALID_CURSOR" as const;

export class TaskNotFoundError extends Error { /* code: TASK_NOT_FOUND */ }
export class InvalidRecurrenceRuleError extends Error { /* code: INVALID_RECURRENCE_RULE */ }
export class TemplateNotFoundError extends Error { /* code: TEMPLATE_NOT_FOUND */ }
export class InvalidLimitError extends Error { /* code: INVALID_LIMIT */ }
export class InvalidCursorError extends Error { /* code: INVALID_CURSOR */ }
```

### `lib/server/api-errors.ts` extension

Append to `mapApiDomainError`:

```ts
import {
  InvalidCursorError,
  InvalidLimitError,
  InvalidRecurrenceRuleError,
  TaskNotFoundError,
  TemplateNotFoundError,
} from "@/lib/domain/tasks/errors";

if (err instanceof TaskNotFoundError) {
  return NextResponse.json({ error: err.code }, { status: 404 });
}
if (err instanceof InvalidRecurrenceRuleError) {
  return NextResponse.json({ error: err.code }, { status: 400 });
}
if (err instanceof TemplateNotFoundError) {
  // 400 (NOT 404) — matches current wire; offline clients code against 400.
  return NextResponse.json({ error: err.code }, { status: 400 });
}
if (err instanceof InvalidLimitError) {
  return NextResponse.json({ error: err.code }, { status: 400 });
}
if (err instanceof InvalidCursorError) {
  return NextResponse.json({ error: err.code }, { status: 400 });
}
```

## Audit baseline path swap (NOT new exemption)

Per `feedback-soak-applies-to-all-promotes.md` and Wave B's lesson — when a grandfathered findMany MOVES, swap the path; do not add new entry.

`.audit-findmany-baseline.json` — replace these 2 entries:

- `app/api/tasks/route.ts::task::0` → `lib/domain/tasks/list-tasks.ts::task::0`
- `app/api/tasks/route.ts::taskOccurrence::0` → `lib/domain/tasks/list-tasks.ts::taskOccurrence::0`

`.audit-findmany-no-select-baseline.json` — replace these 3 entries:

- `app/api/tasks/route.ts::task::0` → `lib/domain/tasks/list-tasks.ts::task::0`
- `app/api/tasks/route.ts::task::1` → `lib/domain/tasks/list-tasks.ts::task::1`
- `app/api/tasks/route.ts::taskOccurrence::0` → `lib/domain/tasks/list-tasks.ts::taskOccurrence::0`

Leave the other task-* entries (task-occurrences, task-templates, task-pins, inngest, route-today, einstein-backfill, admin/tasks page) untouched — out of scope.

## Route-handler-coverage EXEMPT pruning

`__tests__/api/route-handler-coverage.test.ts` — remove these two lines (currently 125-126):

```
"tasks/[id]/route.ts",
"tasks/route.ts",
```

Keep `task-occurrences/route.ts`, `task-templates/[id]/route.ts`, `task-templates/install/route.ts` (Wave E2).
Keep `[farmSlug]/map/task-pins/route.ts`, `farm-settings/tasks/route.ts` (Wave G).

## TDD discipline

For each domain op:

1. **RED** — write failing vitest with mocked Prisma asserting the wire-shape contract.
2. **GREEN** — implement minimum to pass.
3. **REFACTOR** — pull constants/helpers if duplication appears.

Special cases requiring extra test coverage:

- **`updateTask` observation-on-completion** — must verify the `$transaction` callback runs (mock prisma.$transaction with a tx-client that records calls); verify Observation create happens BEFORE Task update; verify denormalised species lookup hits `animal.findUnique`; verify `completedObservationId` is set on Task.
- **`updateTask` no-op completion** — when `observationFromTaskCompletion` returns null, verify the route falls through to standard update and `observationCreated: false`.
- **`listTasksPaginated` cursor decode failure** — verify `InvalidCursorError` thrown with bad cursor string.
- **`createTask` template merge** — verify explicit fields override template defaults; verify template-only fields fill from template.
- **`createTask` recurrence dry-run** — verify `expandRule` is called with correct args before DB write.

Then for routes:

4. Rewrite each route file as adapter wiring (schema parse + adapter call only — no inline auth, no inline try/catch).
5. Re-run all transaction-touching tests — they must still pass:
   - `__tests__/api/tasks.test.ts`
   - `__tests__/api/task-completion-flow.test.ts`
   - `__tests__/admin/tasks-ssr-pagination.test.tsx`

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

- `__tests__/api/route-handler-coverage.test.ts` green with 2 fewer EXEMPT entries.
- All task-touching tests still green:
  - `__tests__/api/tasks.test.ts`
  - `__tests__/api/task-completion-flow.test.ts`
  - `__tests__/admin/tasks-ssr-pagination.test.tsx`
  - `__tests__/api/task-templates.test.ts` (out of scope but must not regress)
  - `__tests__/server/inngest/tasks.test.ts` (out of scope but must not regress)

## Definition of done

- All 8 gates green.
- Diff scoped strictly to allow-list above.
- PR opened referencing #161; `gate` + `require` + `audit-bundle` + `lhci-cold` + `audit-pagination` SUCCESS.
- Soak gate (`require=SUCCESS` for latest SHA) cleared before promote.

## Notes for implementer

- The current `tasks/route.ts` POST has `as=occurrences` GET-mode logic — DO NOT migrate this into POST. Only GET branches into occurrences mode.
- The PATCH `$transaction` callback uses `Parameters<Parameters<typeof prisma.$transaction>[0]>[0]` to derive `TxClient` — preserve this pattern in `update-task.ts` (don't import TxClient from a wrong place).
- `parseTaskArrayFields` and `safeParseArray` helpers in `tasks/route.ts` should move into `lib/domain/tasks/list-tasks.ts` (or a small shared `parse.ts` if also used by `create-task.ts` / `update-task.ts`).
- POST route uses `ctx.session.user?.email ?? ctx.session.user?.name ?? "unknown"` for `createdBy` — make sure adapter passes the right field; the domain op should accept `createdBy: string` as input.
- `revalidateTaskWrite(slug)` is called by all mutations — pass it through `revalidate` adapter option, not inline.
- Tasks routes are ADMIN-only for POST/PATCH/DELETE — use `adminWrite`. GET is any tenant role — use `tenantRead`.
