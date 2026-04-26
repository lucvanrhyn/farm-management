# PayFast Live Cutover Runbook

**Status:** Drafted 2026-04-26. Cutover not yet executed.
**Goal:** flip FarmTrack production from `PAYFAST_SANDBOX=true` (placeholder
sandbox creds pushed during Wave 1 W1c) to live PayFast credentials so
real subscription payments work.

**Why this is a separate cutover:** Wave 1 W1c deferred live cutover to
keep merchant-flow risk surface out of the audit-repair waves. PayFast
verification has since approved the merchant account.

**Estimated change window:** ~5 minutes for the env-var swap + redeploy.
Test transaction adds ~10 minutes. Total: ~15 minutes including validation.

**Risk:** **REAL CARDS START GETTING CHARGED** the moment this is live.
The test transaction is mandatory.

---

## Pre-flight checklist

- [ ] PayFast merchant account is verified (per the user's PayFast dashboard
  showing `my.payfast.io` access, not `sandbox.payfast.co.za`).
- [ ] You have all four secrets ready:
  - `PAYFAST_MERCHANT_ID` (from PayFast dashboard → Settings → Integration)
  - `PAYFAST_MERCHANT_KEY` (same page)
  - `PAYFAST_PASSPHRASE` (4–32 chars, set by you on PayFast dashboard →
    Settings → Integration → Passphrase). **Required** for ITN signature
    verification; without it, valid webhooks will be rejected as forged.
  - `PAYFAST_SANDBOX=false`
- [ ] Capture **current** sandbox values for rollback:
  ```
  vercel env pull .env.preflight-payfast --environment=production
  grep ^PAYFAST_ .env.preflight-payfast > .payfast-rollback.env
  ```
  Save `.payfast-rollback.env` outside the repo (NOT committed).
- [ ] Confirm the ITN webhook URL on PayFast dashboard points at
  `https://farm-management-lilac.vercel.app/api/webhooks/payfast` (or
  whatever the production domain is — check `app/api/webhooks/payfast/route.ts`
  for the canonical path).
- [ ] Confirm at least one PayFast valid IP is allow-listed in
  `lib/payfast.ts:16-23` (`PAYFAST_VALID_IPS` array). Wave 1 should have
  populated this; verify.
- [ ] Have a real card (yours) ready for the R5 test transaction.

## Cutover steps

Total wall-clock budget: ~15 minutes.

### 1. Update Vercel env vars (T+0)

All four go to Production. Use `--sensitive` so they cannot be pulled
back from Vercel into local files (defence against credential leak via
later `vercel env pull`).

```
echo "$LIVE_MERCHANT_ID" | vercel env add PAYFAST_MERCHANT_ID production --sensitive --force
echo "$LIVE_MERCHANT_KEY" | vercel env add PAYFAST_MERCHANT_KEY production --sensitive --force
echo "$LIVE_PASSPHRASE" | vercel env add PAYFAST_PASSPHRASE production --sensitive --force
echo "false" | vercel env add PAYFAST_SANDBOX production --force
```

(Note: `PAYFAST_SANDBOX=false` doesn't need `--sensitive` — it's a
boolean flag, not a secret.)

If Preview should match Production (it should — preview branches need to
exercise the same code path), repeat with `preview` instead of
`production`.

### 2. Trigger a fresh production deploy (T+2)

```
vercel --prod
```

Wait for "Ready" (~3 min). The new Lambdas pick up the rotated env on
cold start. Old warm Lambdas may still hold sandbox values for ~15-60 min;
typically fine because subscription POSTs go through a fresh Lambda.

### 3. Smoke-test the build URL endpoints (T+5)

These should respond as before — the env change shouldn't have broken
anything structurally:

- [ ] `GET https://farm-management-lilac.vercel.app/subscribe` → 307 to
  /login (or whatever the unauthed redirect target is).
- [ ] Log in, hit `/subscribe`, confirm the PayFast widget renders or the
  build-subscription-URL flow returns a URL pointing at
  `https://payfast.co.za/eng/process` (NOT sandbox).

If the URL still says `sandbox.payfast.co.za`, the env didn't propagate —
abort and rollback (step 6).

### 4. R5 LIVE test transaction (T+10)

This is the one mandatory verification step.

1. From your account, click "Subscribe" on the lowest tier.
2. PayFast redirects you to its hosted checkout. Confirm the URL is
   `payfast.co.za` (NOT sandbox).
3. Pay R5 with a real card (set the test tier price to R5 temporarily if
   none exists — see `lib/payment/lsu-pricing.ts` for the price table).
4. Complete the redirect back to FarmTrack. Confirm:
   - The success page renders.
   - The ITN webhook fires within ~30 seconds (watch
     `vercel logs --filter='payfast'`).
   - The user's subscription row in the meta DB shows
     `subscription_status='active'`:
     ```
     turso db shell farmtrack-meta-lucvanrhyn \
       "SELECT slug, tier, subscription_status FROM farms WHERE slug = 'YOUR_SLUG';"
     ```
5. **Refund the R5 from PayFast dashboard** within 24 h (PayFast charges
   a refund fee but it's negligible; the point is to leave no real
   transaction on the books for a test).

If the ITN webhook does NOT fire:
- Check `vercel logs --filter='/api/webhooks/payfast'` for 401/403 → the
  passphrase is wrong (most likely cause). Rollback (step 6) and re-check
  the passphrase against PayFast dashboard.
- Check `lib/payfast.ts::isValidPayfastIp` rejection. The PayFast IP
  ranges may have changed; the dashboard's "We have extended our IP
  Range" banner (visible in your screenshot) suggests they did. Update
  `PAYFAST_VALID_IPS` in `lib/payfast.ts`, push a hotfix, redeploy.

### 5. Soak for 24 h (T+15 + 24 h)

Watch for any organic subscription attempts that fail. With pre-launch
traffic this should be zero.

### 6. Rollback (only if any verification fails)

```
echo "$(grep ^PAYFAST_MERCHANT_ID .payfast-rollback.env | cut -d= -f2)" | vercel env add PAYFAST_MERCHANT_ID production --sensitive --force
echo "$(grep ^PAYFAST_MERCHANT_KEY .payfast-rollback.env | cut -d= -f2)" | vercel env add PAYFAST_MERCHANT_KEY production --sensitive --force
echo "$(grep ^PAYFAST_PASSPHRASE .payfast-rollback.env | cut -d= -f2)" | vercel env add PAYFAST_PASSPHRASE production --sensitive --force
echo "true" | vercel env add PAYFAST_SANDBOX production --force
vercel --prod
```

This restores the sandbox-on-prod state from before the cutover.

## Post-cutover

- [ ] Update `MEMORY.md` to remove the `PAYFAST_*` "missing from Prod"
  action item.
- [ ] Update [audit-waves-historical-2026-04-25.md](audit-waves-historical-2026-04-25.md)
  open-followup section: remove "PayFast live cutover".
- [ ] If you used a placeholder R5 tier just for the test, restore the
  real tier price.
- [ ] **Rotate the merchant key** if it was ever exposed (e.g. if the
  PayFast dashboard screenshot ended up in chat history). PayFast
  dashboard → Settings → Integration → "Generate new Merchant Key".
  Then re-run step 1 with the new key.

## Open items / known risks

- **No payment-failed user-facing UI** today. If the R5 test exposes a
  rendering issue on the failure path, prioritize that over launch.
- **No automated subscription-status reconciliation** (e.g., a daily
  cron that compares PayFast's subscription state against the meta-DB
  row). Out of scope for the cutover; track separately.
- **PayFast IP range banner** on the dashboard ("We have extended our
  IP Range") implies `PAYFAST_VALID_IPS` may need updating. Verify
  against PayFast's current published list before cutover. If
  rejected webhooks surface, this is the most likely cause.
