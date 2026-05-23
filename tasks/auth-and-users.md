# Auth & Users — sign-in identifier contract

Owner: Luc · Last reviewed: 2026-05-13 · Issue: [#261](https://github.com/lucvanrhyn/farm-management/issues/261) · PRD: [#250](https://github.com/lucvanrhyn/farm-management/issues/250)

## TL;DR

**Sign-in identifier: username only (no email). Onboarding assigns the username.**

Users authenticate with their unique `username`. The `email` column on
`users` exists for verification, password-reset, and notification flows
— it is **not** an accepted sign-in identifier.

## Why username-only

Pre-Wave-6b (#261) the lookup was `WHERE email = ? OR username = ?`,
which silently failed in two ways:

1. Bare-username sign-in went through but stress-test against production
   on 2026-05-13 found `luc` failed while `luc@farmtrack.app` worked
   (account-enumeration-driven inconsistency from the OR clause + a
   rate-limit key collision).
2. A user typing the wrong identifier got the same generic "wrong
   password" toast as a user typing the wrong password — no signal which
   field to fix.

Username-only resolves both: a single resolution path, a single error
copy ("Wrong username or password — try again"), and a fail-closed
typed-result lookup (`findUserByIdentifier`) that cannot silently pick
the first row of an ambiguous match.

The maintainer rejected `username-OR-email` as an alternative because it
preserves the OR-clause class of bug for a marginal UX win — every
existing user already knows their username (`luc`, `dicky`, `oupa`,
`dewet` per `scripts/seed-meta-db.ts`).

## Contract

### Sign-in form (`app/(auth)/login/page.tsx`)

- One field labelled **"Username"** (no "Email or username", no "Email").
- Placeholder: `username`.
- `autoComplete="username"`.
- Errors:
  - Bad credentials → `Wrong username or password — try again.`
  - Network failure → `Couldn't reach the server — check your connection.`
  - All other typed errors (rate-limit, server-misconfig, db-unavailable,
    email-not-verified) keep their existing copy in
    `AUTH_ERROR_COPY` (see same file).
- The form NEVER swallows an error path silently — every branch sets
  the inline `role="alert"` toast.

### Lookup (`lib/meta-db.ts`)

`findUserByIdentifier(identifier: string): Promise<FindUserResult>`

- Returns `{ ok: true, user }` on a single username match.
- Returns `{ ok: false, code: 'NOT_FOUND' }` on no match (including
  empty / whitespace-only input — guarded without a DB round-trip).
- Returns `{ ok: false, code: 'AMBIGUOUS' }` if >1 row matches. With
  meta-migration 0003 in place this is physically impossible, but the
  branch exists as defence-in-depth: if a legacy meta-DB without the
  unique index ever surfaces a duplicate, the auth surface refuses to
  authenticate (NextAuth + `/api/auth/login-check` both translate
  AMBIGUOUS → `SERVER_MISCONFIGURED`) instead of silently picking row
  zero.

The legacy `getUserByIdentifier` is retained as a thin shim for non-auth
callers (e.g. ad-hoc scripts) but **MUST NOT** be used in new auth code.
It now resolves username-only as well.

### NextAuth (`lib/auth-options.ts`)

The Credentials provider's `identifier` field carries the username verbatim.
The field is named `identifier` (not `username`) for backwards compatibility
with the pre-existing pre-flight route (`/api/auth/login-check`) and the
Playwright fixture in `e2e/fixtures/auth.ts` — renaming it would force a
synchronised change across both surfaces with no functional benefit.

`authorize()`:
1. Reject empty `identifier` / `password` → `INVALID_CREDENTIALS`.
2. Rate-limit by `login:${identifier}` (10/min).
3. `findUserByIdentifier(identifier)`.
   - DB throw → `SERVER_MISCONFIGURED` (env vars missing) or
     `DB_UNAVAILABLE` (anything else).
   - `AMBIGUOUS` → `SERVER_MISCONFIGURED` + `logger.error`.
   - `NOT_FOUND` → `INVALID_CREDENTIALS` (generic, anti-enumeration).
4. `bcrypt.compare(password, user.passwordHash)` mismatch →
   `INVALID_CREDENTIALS`.
5. If `user.email` is non-null, `isEmailVerified(user.id)`. False →
   `EMAIL_NOT_VERIFIED`.
6. Resolve farms + role, return user.

`/api/auth/login-check` mirrors steps 1–5 in HTTP form (always 200 with
`{ ok, reason? }`, except true server faults which are 500).

### Storage

`users` table on the meta-DB:

```sql
CREATE TABLE users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT UNIQUE,             -- nullable; used for verify/reset, NOT sign-in
  username              TEXT UNIQUE NOT NULL,    -- sole sign-in identifier
  password_hash         TEXT NOT NULL,
  name                  TEXT,
  email_verified        INTEGER NOT NULL DEFAULT 0,
  verification_token    TEXT,
  verification_expires  TEXT,
  created_at            TEXT NOT NULL
);
```

Uniqueness is enforced two ways:

- **Column-level** `UNIQUE NOT NULL` for any meta-DB created via
  `scripts/seed-meta-db.ts` (seed script gained the keyword in earlier
  work).
- **Index-level** `CREATE UNIQUE INDEX users_username_unique ON
  users(username)` via `meta-migrations/0003_user_username_unique.sql`
  for any meta-DB that pre-dates the seed-script update. The migration
  is idempotent (`IF NOT EXISTS`) so re-running is safe.

A duplicate existing in the meta-DB at migration time will fail the
migration — that's the correct outcome. An operator must reconcile the
rows before sign-in works for either user.

## Onboarding (out of scope for this wave)

Wave 6b (#261) does NOT change the registration / onboarding flow. The
existing `app/api/auth/register/route.ts` requires both `email` and
`username` at sign-up; that contract stays as-is for now.

A future onboarding wave should ensure:
- Username is chosen / assigned at sign-up and is mandatory.
- Username uniqueness is checked client-side before submit (not just at
  the DB constraint level).
- The user is shown their username on first sign-in to anchor recall.

## Deprecation log

- 2026-05-13 — Wave 6b (#261): retired `WHERE email = ? OR username = ?`
  in favour of `findUserByIdentifier` (typed result, username only).
  `getUserByIdentifier` retained as a deprecated shim for non-auth
  callers. Login form re-labelled to "Username". Network-error toast
  added. Meta-migration 0003 enforces uniqueness in storage.
