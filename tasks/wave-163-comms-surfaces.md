# Wave F — Comms surfaces domain extraction (#163)

ADR-0001 rollout, sixth wave. Bundles three small comms-adjacent CRUD surfaces — notifications, photos/upload, push/subscribe — onto the Wave A `tenantRead` / `tenantWrite` / `adminWrite` adapters. Tracker: [#163](https://github.com/lucvanrhyn/farm-management/issues/163).

## Why

Each of these surfaces is too small individually to justify a dedicated wave (84 / 51 / 59 lines). Bundled, they're comparable in size to Wave D's transactions surface (~203 lines). All three share the same migration shape: lift hand-rolled auth + body-parse + free-text 400s onto the adapters, route errors through `mapApiDomainError`.

The notifications GET route is the trickiest of the three because it must preserve a `Cache-Control` + `Server-Timing` header pair that the existing `notifications-cache-control.test.ts` asserts.

## Scope (file allow-list — do not edit outside)

### New files

```
lib/domain/notifications/list-notifications.ts
lib/domain/notifications/mark-notification-read.ts
lib/domain/notifications/mark-all-notifications-read.ts
lib/domain/notifications/index.ts
lib/domain/notifications/__tests__/list-notifications.test.ts
lib/domain/notifications/__tests__/mark-notification-read.test.ts
lib/domain/notifications/__tests__/mark-all-notifications-read.test.ts
lib/domain/photos/upload-photo.ts
lib/domain/photos/errors.ts
lib/domain/photos/index.ts
lib/domain/photos/__tests__/upload-photo.test.ts
lib/domain/push/subscribe-push.ts
lib/domain/push/unsubscribe-push.ts
lib/domain/push/errors.ts
lib/domain/push/index.ts
lib/domain/push/__tests__/subscribe-push.test.ts
lib/domain/push/__tests__/unsubscribe-push.test.ts
tasks/wave-163-comms-surfaces.md   # this file
```

### Modified

```
app/api/notifications/route.ts
app/api/notifications/[id]/route.ts
app/api/notifications/read-all/route.ts
app/api/photos/upload/route.ts
app/api/push/subscribe/route.ts
lib/server/api-errors.ts
__tests__/api/route-handler-coverage.test.ts
```

### Out of scope (deferred to later waves)

- `app/api/onboarding/{map-columns,template,commit-import}/route.ts` — `commit-import` is SSE streaming + `template` returns binary Excel; both contracts need adapter extensions outside this wave's scope.
- `app/api/sheets/route.ts` — 9-line stub returning 501; no domain to extract.
- `app/api/map/gis/eskom-se-push/**` — Wave G (different surface despite name).
- `lib/server/push-sender.ts` — out-of-route push delivery library; out of ADR-0001 scope.

## Wire-shape contract

### Preserved (back-compat — admin UI + service worker depend on these)

- `GET /api/notifications` → 200 `{ items: Notification[], unreadCount: number }` with `Cache-Control: private, max-age=15, stale-while-revalidate=45` + `Server-Timing` headers
- `PATCH /api/notifications/[id]` → 200 `{ success: true }`
- `POST /api/notifications/read-all` → 200 `{ success: true }`
- `POST /api/photos/upload` → 200 `{ url: string }`
- `POST /api/push/subscribe` → 200 `{ success: true }`
- `DELETE /api/push/subscribe` → 200 `{ success: true }`

### Refined (free-text → typed code)

| Old wire | New wire | Status |
|---|---|---|
| `503 { error: "Photo uploads are not configured. Please contact your administrator." }` | `503 { error: "BLOB_NOT_CONFIGURED" }` | 503 |
| `400 { error: "No file provided" }` | `400 { error: "MISSING_FILE" }` | 400 |
| `413 { error: "File too large (max 4MB)" }` | `413 { error: "FILE_TOO_LARGE" }` | 413 |
| `415 { error: "Only image files are allowed (JPEG, PNG, WebP, HEIC)." }` | `415 { error: "INVALID_FILE_TYPE" }` | 415 |
| `500 { error: "Photo upload failed. Please try again." }` | `500 { error: "BLOB_UPLOAD_FAILED" }` | 500 |
| `400 { error: "Invalid subscription" }` | `400 { error: "INVALID_SUBSCRIPTION" }` | 400 |
| `400 { error: "Missing endpoint" }` | `400 { error: "MISSING_ENDPOINT" }` | 400 |
| `401 { error: "Unauthorized" }` | preserved (adapter-emitted) | 401 |

## Domain ops contract

All ops are pure functions; adapters supply tenant-scoped Prisma + slug + session.

### notifications

```ts
// list-notifications.ts
export interface ListNotificationsResult {
  items: Notification[];
  unreadCount: number;
}
export async function listNotifications(slug: string, userEmail: string): Promise<ListNotificationsResult>
// Wraps existing `getCachedNotifications(slug, userEmail)` from `lib/server/cached.ts`.
// No new errors — cache miss falls through silently.

// mark-notification-read.ts
export async function markNotificationRead(prisma: PrismaClient, id: string): Promise<{ success: true }>
// updateMany({ where: { id }, data: { isRead: true } }) — silent no-op if id missing.

// mark-all-notifications-read.ts
export async function markAllNotificationsRead(prisma: PrismaClient): Promise<{ success: true }>
// updateMany({ where: { isRead: false }, data: { isRead: true } }).
```

### photos

```ts
// upload-photo.ts
export async function uploadPhoto(slug: string, file: File): Promise<{ url: string }>
// Validates file size + type, calls @vercel/blob put with key `farm-photos/{slug}/{ts}-{name}`.
// Throws BlobNotConfiguredError if BLOB_READ_WRITE_TOKEN unset.
// Throws FileTooLargeError if size > 4 MB.
// Throws InvalidFileTypeError if not in [image/jpeg, image/png, image/webp, image/heic].
// Throws BlobUploadFailedError on Vercel Blob error.
// Note: this op does NOT use Prisma — it's pure infrastructure.
```

### push

```ts
// subscribe-push.ts
export interface SubscribePushInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export async function subscribePush(prisma: PrismaClient, userEmail: string, input: SubscribePushInput): Promise<{ success: true }>
// Throws InvalidSubscriptionError if endpoint/keys missing.

// unsubscribe-push.ts
export async function unsubscribePush(prisma: PrismaClient, userEmail: string, endpoint: string): Promise<{ success: true }>
// Throws MissingEndpointError if endpoint missing.
// Scopes deleteMany by userEmail so no one can unsubscribe another user.
```

## Errors modules

### `lib/domain/photos/errors.ts`

```ts
export const BLOB_NOT_CONFIGURED = "BLOB_NOT_CONFIGURED" as const;
export const MISSING_FILE = "MISSING_FILE" as const;
export const FILE_TOO_LARGE = "FILE_TOO_LARGE" as const;
export const INVALID_FILE_TYPE = "INVALID_FILE_TYPE" as const;
export const BLOB_UPLOAD_FAILED = "BLOB_UPLOAD_FAILED" as const;

export class BlobNotConfiguredError extends Error { /* code: BLOB_NOT_CONFIGURED */ }
export class MissingFileError extends Error { /* code: MISSING_FILE */ }
export class FileTooLargeError extends Error { /* code: FILE_TOO_LARGE; size: number */ }
export class InvalidFileTypeError extends Error { /* code: INVALID_FILE_TYPE; type: string */ }
export class BlobUploadFailedError extends Error { /* code: BLOB_UPLOAD_FAILED */ }
```

### `lib/domain/push/errors.ts`

```ts
export const INVALID_SUBSCRIPTION = "INVALID_SUBSCRIPTION" as const;
export const MISSING_ENDPOINT = "MISSING_ENDPOINT" as const;

export class InvalidSubscriptionError extends Error { /* code: INVALID_SUBSCRIPTION */ }
export class MissingEndpointError extends Error { /* code: MISSING_ENDPOINT */ }
```

(notifications has no business-rule errors — only adapter-emitted 401/403.)

## `lib/server/api-errors.ts` extension

Append to `mapApiDomainError`:

```ts
import {
  BlobNotConfiguredError,
  BlobUploadFailedError,
  FileTooLargeError,
  InvalidFileTypeError,
  MissingFileError,
} from "@/lib/domain/photos/errors";
import {
  InvalidSubscriptionError,
  MissingEndpointError,
} from "@/lib/domain/push/errors";

if (err instanceof BlobNotConfiguredError) {
  return NextResponse.json({ error: err.code }, { status: 503 });
}
if (err instanceof MissingFileError) {
  return NextResponse.json({ error: err.code }, { status: 400 });
}
if (err instanceof FileTooLargeError) {
  return NextResponse.json({ error: err.code }, { status: 413 });
}
if (err instanceof InvalidFileTypeError) {
  return NextResponse.json({ error: err.code }, { status: 415 });
}
if (err instanceof BlobUploadFailedError) {
  return NextResponse.json({ error: err.code }, { status: 500 });
}
if (err instanceof InvalidSubscriptionError) {
  return NextResponse.json({ error: err.code }, { status: 400 });
}
if (err instanceof MissingEndpointError) {
  return NextResponse.json({ error: err.code }, { status: 400 });
}
```

## Cache-Control preservation (critical)

The current `notifications/route.ts` GET returns:

```ts
return NextResponse.json(payload, {
  headers: {
    "Cache-Control": "private, max-age=15, stale-while-revalidate=45",
    "Server-Timing": serverTiming,
  },
});
```

The Wave F migration MUST preserve both headers. The adapter does NOT strip user-set headers — verify by reading `lib/server/route/tenant-read.ts` and confirming the response is returned as-is from `handle`.

`__tests__/api/notifications-cache-control.test.ts` asserts:
- `Cache-Control` contains `private`, `max-age=15`, `stale-while-revalidate=45`
- `Server-Timing` contains `auth`, `cache`, `total` durations

If the adapter normalizes responses in a way that drops these, STOP and report — that's a Wave A regression that needs its own fix before Wave F can ship.

## Photos formData handling

The current photos/upload route uses `req.formData()` not JSON. The adapter's `WriteHandle` signature includes `req` as the 3rd argument, so the route can do its own formData parsing inside the `handle`:

```ts
export const POST = adminWrite({
  handle: async (ctx, _body, req) => {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new MissingFileError();
    const result = await uploadPhoto(ctx.slug, file);
    return NextResponse.json(result);
  },
});
```

No `schema` field — the adapter skips JSON body parse. The `_body` param is `unknown` (unused).

**Decision: photos/upload should use `tenantWrite` not `adminWrite`** — the current route only requires authenticated session, not ADMIN. Confirm by reading current route handler. (The current route has NO role check — only `getFarmContext` for auth — so `tenantWrite` is correct.)

## Route-handler-coverage EXEMPT pruning

`__tests__/api/route-handler-coverage.test.ts` — remove these five lines (currently 113-115, 119-120):

```
"notifications/[id]/route.ts",
"notifications/read-all/route.ts",
"notifications/route.ts",
"photos/upload/route.ts",
"push/subscribe/route.ts",
```

Keep `sheets/route.ts` (stub, out of scope).
Keep `map/gis/eskom-se-push/**` (Wave G).

## TDD discipline

For each domain op:

1. **RED** — write failing vitest with mocked Prisma (or mocked Vercel Blob `put` for photos) asserting the wire-shape contract.
2. **GREEN** — implement minimum to pass.
3. **REFACTOR** — pull constants/helpers if duplication appears.

Wrap shared mock state in `vi.hoisted()` to dodge TDZ (per `feedback-vi-hoisted-shared-mocks.md`).

For `uploadPhoto`:
- Mock `@vercel/blob` `put` via `vi.mock("@vercel/blob")`.
- Test all 5 error branches (no env, missing file, too large, bad type, blob throws).
- Verify the blob key format `farm-photos/{slug}/{ts}-{safeName}` (regex match on the timestamp).
- Verify safe-name sanitization (`.replace(/[^a-zA-Z0-9._-]/g, '_')`).

For `subscribePush`:
- Mock `prisma.pushSubscription.upsert` and verify the where/create/update payload.

Then for routes:

4. Rewrite each route file as adapter wiring (schema parse + adapter call only — no inline auth, no inline try/catch).
5. Re-run all comms-touching tests:
   - `__tests__/api/notifications-cache-control.test.ts`
   - `__tests__/components/notification-bell-polling.test.tsx`
   - `__tests__/db/notification-index.test.ts`
   - `__tests__/notifications/**`
   - `__tests__/lib/sync-manager-cover-photo-failure.test.ts`
   - `__tests__/offline/photo-sync.test.ts`

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

- `__tests__/api/route-handler-coverage.test.ts` green with 5 fewer EXEMPT entries.
- `__tests__/api/notifications-cache-control.test.ts` green (Cache-Control + Server-Timing preserved).
- All other comms tests still green.

## Definition of done

- All 8 gates green.
- Diff scoped strictly to allow-list above.
- PR opened referencing #163; `gate` + `require` + `audit-bundle` + `lhci-cold` + `audit-pagination` SUCCESS.
- Soak gate (`require=SUCCESS` for latest SHA) cleared before promote.

## Notes for implementer

- Three separate domain folders (`lib/domain/notifications/`, `lib/domain/photos/`, `lib/domain/push/`) — do NOT bundle into a shared "comms" folder. ADR-0001 is per-entity.
- `notifications/route.ts` GET uses `getCachedNotifications` from `lib/server/cached.ts`. Don't duplicate the cache layer; just wrap it. The `listNotifications` op is essentially a re-export with a typed signature.
- `notifications/route.ts` GET also emits `Server-Timing` header via `emitServerTiming` — preserve that exactly. Move the timing math into the route's `handle` (the op doesn't need timing instrumentation).
- `push/subscribe/route.ts` POST has a unique adapter consideration: it requires `userEmail` to be present (not just authenticated). The current code does `if (!ctx || !userEmail)` returning 401. Preserve this — `tenantWrite` only checks for `ctx`, not `userEmail`. Either: (a) handle this in the route layer (`if (!ctx.session.user?.email) return 401`), or (b) extend the op to throw a typed error. (a) is simpler.
- `push/subscribe/route.ts` DELETE scopes by `userEmail` — make sure the op signature requires `userEmail` as input (not optional).
- `photos/upload/route.ts` uses `tenantWrite` (any authenticated tenant role), NOT `adminWrite` — current route has no role check.
- `notifications/route.ts` GET uses `tenantRead` — preserve the cache-control + server-timing headers in the `handle` return.
- `notifications/[id]/route.ts` PATCH and `notifications/read-all/route.ts` POST — these have no role check in current code. Use `tenantWrite` (any authenticated tenant role).
