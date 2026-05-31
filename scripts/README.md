# Scripts

Operational and audit scripts. Most read `.env.local` via `dotenv-cli`.

## seed-test-admin.ts — test-admin meta-DB seed (closes #108)

Provisions a verified `ADMIN` login in the **meta DB** and links it to an
**existing** tenant, so an AFK / CI agent can authenticate against a real branch
clone without hand-provisioning credentials. This is the code half of the #108
gate (issue #527). **Running it once with the meta creds present closes #108 —
it is an operator step.**

Deep logic lives in `lib/ops/seed-test-admin.ts` (injectable + unit-tested);
this script is a thin env-wiring wrapper. It is idempotent (`INSERT OR IGNORE`),
hashes the password with **bcrypt cost 12** (matching the register route), sets
`email_verified = 1`, and **never creates farms** — the target tenant must
already exist.

Run:

```sh
npx dotenv-cli -e .env.local -- npx tsx scripts/seed-test-admin.ts
```

Required env (add to `.env.local`):

| Var | Purpose |
| --- | --- |
| `META_TURSO_URL` | URL of the meta Turso DB |
| `META_TURSO_AUTH_TOKEN` | Auth token for the meta Turso DB |
| `TEST_ADMIN_EMAIL` | Email for the seeded admin account |
| `TEST_ADMIN_PASSWORD` | Plaintext password (hashed at bcrypt cost 12) |
| `TEST_ADMIN_FARM_SLUG` | Slug of the **existing** tenant to grant `ADMIN` on |

Optional:

| Var | Purpose |
| --- | --- |
| `SEED_TEST_ADMIN_FORCE=1` | Bypass the prod-tenant guard (`basson-boerdery`). Use only when you are certain. |

The seed is gated to non-prod tenants: it refuses the live client tenant
`basson-boerdery` unless `SEED_TEST_ADMIN_FORCE=1` is set. Never hardcode
credentials — everything is read from the environment.
