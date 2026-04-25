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

### 2b. `PAYFAST_*` (production — preview already has sandbox creds)

Per memory: **production is missing all four PayFast keys**, preview already
has sandbox values. Production should remain unset until PayFast finishes
verifying the merchant address (see `memory/payfast-pending.md`); keep this
section parked until that gates clears, or push placeholder sandbox values
and re-run when the prod creds arrive.

- **Source:** PayFast merchant portal → Account → Integration. Use the
  **live** keys for production (sandbox keys belong on preview only).

```bash
# Run only after PayFast address verification clears.
vercel env add PAYFAST_MERCHANT_ID production --value '__REDACTED__' --yes
vercel env add PAYFAST_MERCHANT_KEY production --value '__REDACTED__' --yes
vercel env add PAYFAST_PASSPHRASE production --value '__REDACTED__' --yes
vercel env add PAYFAST_SANDBOX production --value 'false' --yes
```

### 2c. (Optional) sync any other drift surfaced by the diff in step 1

Use the bulk-copy loop from `ops-gotchas-vercel-cli.md` §"Bulk-copy loop that
actually works" if Production has keys Preview lacks (or vice versa). Common
candidates seen in past audits: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`,
`PLATFORM_ADMIN_EMAILS`, `ESKOMSEPUSH_TOKEN`. Confirm before pushing.

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
