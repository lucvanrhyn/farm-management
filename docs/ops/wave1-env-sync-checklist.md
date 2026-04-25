# Wave 1 W1c — Vercel env sync checklist

Generated 2026-04-25 by Wave 1 sub-agent W1c. Phase D of the audit-wave plan
(see `memory/audit-wave-plan-2026-04-25.md`). The agent is **not** authorised
to mutate Vercel directly; this file lists the exact `vercel env add` commands
the user (or the parent main-session agent) must run.

Read `memory/ops-gotchas-vercel-cli.md` first — the empty-string positional
gotcha (`vercel env add VAR preview '' --value …`) is why most of the commands
below have a stray `''` between the env target and `--value`.

---

## 1. Pre-flight

```bash
# Confirm you are on the lucvanrhyn/farm-management Vercel project + team:
vercel whoami
vercel project ls | grep farm-management

# Snapshot what's already there before mutating anything:
vercel env pull --environment=production /tmp/prod-env-pre-w1c
vercel env pull --environment=preview /tmp/preview-env-pre-w1c
diff <(grep -o '^[A-Z_]*' /tmp/prod-env-pre-w1c | sort -u) \
     <(grep -o '^[A-Z_]*' /tmp/preview-env-pre-w1c | sort -u)
```

---

## 2. Keys to push

Per `memory/MEMORY.md` action items + the audit's "Vercel Prod/Preview missing"
list. Confirm with `grep '^KEY=' /tmp/prod-env-pre-w1c` before re-adding any
key — if it's already present, **skip** that command (re-adding errors).

### 2a. `BLOB_READ_WRITE_TOKEN` (production + preview)

Photo uploads (`/api/photos/upload`) silently fall back without this. The
audit's MEMORY action item explicitly lists this as missing on both targets.

- **Source:** Vercel dashboard → `farm-management` project → Storage → Blob
  → "Tokens" tab → copy the read-write token (starts with `vercel_blob_rw_`).

```bash
vercel env add BLOB_READ_WRITE_TOKEN production --value '__REDACTED__' --yes
vercel env add BLOB_READ_WRITE_TOKEN preview '' --value '__REDACTED__' --yes
```

### 2b. `PAYFAST_*` (production — push sandbox values temporarily)

User decision (2026-04-25, Wave 1 review): PayFast verification is approved
but live merchant creds will be wired in only AFTER all four waves of the
audit-repair plan ship. To unblock prod deploys in the meantime, push the
**same sandbox values currently on preview** to production with
`PAYFAST_SANDBOX=true`. Real flag flips to `false` and live keys land in a
post-Wave-4 sweep.

- **Source:** copy from preview (don't re-fetch from PayFast portal):

```bash
vercel env pull --environment=preview /tmp/preview-env-pre-w1c
PAYFAST_MERCHANT_ID=$(grep '^PAYFAST_MERCHANT_ID=' /tmp/preview-env-pre-w1c | cut -d= -f2- | tr -d '"')
PAYFAST_MERCHANT_KEY=$(grep '^PAYFAST_MERCHANT_KEY=' /tmp/preview-env-pre-w1c | cut -d= -f2- | tr -d '"')
PAYFAST_PASSPHRASE=$(grep '^PAYFAST_PASSPHRASE=' /tmp/preview-env-pre-w1c | cut -d= -f2- | tr -d '"')

vercel env add PAYFAST_MERCHANT_ID production --value "$PAYFAST_MERCHANT_ID" --yes
vercel env add PAYFAST_MERCHANT_KEY production --value "$PAYFAST_MERCHANT_KEY" --yes
vercel env add PAYFAST_PASSPHRASE production --value "$PAYFAST_PASSPHRASE" --yes
vercel env add PAYFAST_SANDBOX production --value 'true' --yes  # NB: TRUE temporarily

# After Wave 4 — replace with live merchant creds + flip sandbox to false:
# vercel env rm PAYFAST_MERCHANT_ID production --yes
# vercel env add PAYFAST_MERCHANT_ID production --value '<LIVE_FROM_PORTAL>' --yes
# (repeat for KEY, PASSPHRASE, then PAYFAST_SANDBOX=false)
```

**Update `memory/payfast-pending.md`** when the sandbox push lands and again
when the live cutover happens.

### 2c. (Optional) sync any other drift surfaced by the diff in step 1

Use the bulk-copy loop from `ops-gotchas-vercel-cli.md` §"Bulk-copy loop that
actually works" if Production has keys Preview lacks (or vice versa). Common
candidates seen in past audits: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`,
`PLATFORM_ADMIN_EMAILS`, `ESKOMSEPUSH_TOKEN`. Confirm before pushing.

---

### 2d. Rotate Turso auth tokens for the migrated farm DB

The existing `TURSO_AUTH_TOKEN` in `.env.local` was issued for the Tokyo
host (`trio-b-boerdery-lucvanrhyn`). It currently still authorises the
Ireland host because Turso treats them as the same logical DB during the
soak window — but it goes dead the moment the legacy DB is destroyed
(`turso db destroy` on or after 2026-05-09 per
`memory/audit-wave-plan-2026-04-25.md`). Mint fresh tokens for the
post-cutover hosts and store them with **no expiry** per the lesson in
`memory/ops-incidents.md`:

```bash
turso auth login   # if 'turso auth whoami' is empty
turso db tokens create trio-b-boerdery-dub --expiration none
turso db tokens create basson-boerdery-dub --expiration none

# Push to Vercel (production + preview must match):
vercel env add TURSO_AUTH_TOKEN production --value '<token-from-trio-b>' --yes
vercel env add TURSO_AUTH_TOKEN preview '' --value '<token-from-trio-b>' --yes
```

Note: `TURSO_AUTH_TOKEN` is a single value because production currently
serves a single tenant (Trio B). Once a second tenant lands on Vercel the
correct shape is per-farm token storage in the meta DB
(`farms.turso_auth_token`) — that wiring already exists; the env-level
token is only the bootstrap default.

### 2e. `META_TURSO_URL` — open question (NOT yet pushed)

The Phase E cutover migrated **per-farm DBs only**. The meta DB itself is
still on `farmtrack-meta-lucvanrhyn.aws-ap-northeast-1.turso.io` (Tokyo)
according to:

1. `vercel env pull --environment=preview` → returns the Tokyo host.
2. `docs/ops/frankfurt-cutover-runbook.md` — meta DB swap is described
   only as "export the URL so the migrate script can write to it",
   never as "destination of the swap".
3. `memory/workstream-perf-complete-2026-04-24.md` §"Meta DB state after
   cutover".

The user may want to migrate the meta DB to Ireland in a later cutover
(latency consistency), but that's a separate runbook — **not** Wave 1
work. If/when that runs:

```bash
vercel env rm META_TURSO_URL production --yes
vercel env rm META_TURSO_URL preview --yes
vercel env add META_TURSO_URL production --value 'libsql://farmtrack-meta-dub-lucvanrhyn.aws-eu-west-1.turso.io' --yes
vercel env add META_TURSO_URL preview '' --value 'libsql://farmtrack-meta-dub-lucvanrhyn.aws-eu-west-1.turso.io' --yes
# + new META_TURSO_AUTH_TOKEN minted with --expiration none against the new DB
```

The hostname above (`farmtrack-meta-dub-lucvanrhyn`) is the convention
used for the per-farm DBs; verify against `turso db list` before pushing.

---

## 3. Post-push verification

```bash
# Re-pull and confirm the new keys landed on both targets:
vercel env pull --environment=production /tmp/prod-env-post-w1c
vercel env pull --environment=preview /tmp/preview-env-post-w1c

grep '^BLOB_READ_WRITE_TOKEN=' /tmp/prod-env-post-w1c       # expect non-empty
grep '^BLOB_READ_WRITE_TOKEN=' /tmp/preview-env-post-w1c    # expect non-empty
# (PayFast block — only if you ran step 2b)
grep '^PAYFAST_MERCHANT_ID='   /tmp/prod-env-post-w1c       # expect non-empty

# Trigger a redeploy so each lambda picks up the new env (Vercel does NOT
# rotate env across in-flight deployments automatically):
vercel redeploy <prod-deployment-id>
```

A sanity smoke after redeploy: hit `/admin/observations` with a photo
attached. If the upload returns 200 (not 500), Blob is wired.

---

## 4. Update memory

Once both targets are green, edit `memory/MEMORY.md` action items so the
"BLOB_READ_WRITE_TOKEN missing" + "PAYFAST_* missing" bullets read as
resolved, with the date.

---

## Known gotchas (don't re-discover)

- **Empty-string branch arg for preview** — see `ops-gotchas-vercel-cli.md`.
  Without it, `vercel env add` errors with `git_branch_required`.
- **Trailing newlines on copy-paste tokens** — past sweeps found `\n` snuck
  into `META_TURSO_AUTH_TOKEN`, `OPENAI_API_KEY`, etc.; Node 22+'s strict
  undici then rejected every Turso request. Use `tr -d '\n'` when piping
  values from a clipboard or shell file.
- **Never pass real secrets through this checklist** — keep the `--value`
  literals as `__REDACTED__` and substitute live values only at run time.
