import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  generateSignature,
  isValidPayFastIP,
  validateITN,
  type PayFastParams,
} from '@/lib/payfast';
import { getFarmSubscription, updateFarmSubscription } from '@/lib/meta-db';
import { withFarmPrisma } from '@/lib/farm-prisma';
import { logger } from '@/lib/logger';
import { publicHandler } from '@/lib/server/route';

/**
 * PayFast ITN (Instant Transaction Notification) webhook.
 * PayFast POSTs to this endpoint after a payment event.
 *
 * Validation steps:
 *   1. Source IP must be a known PayFast IP.
 *   2. Signature must match our regenerated signature.
 *   3. Server-side validate via PayFast's validate endpoint.
 *   4. Token must match the farm's currently-stored payfast_token (or the
 *      farm has none yet — first activation).
 *   5. pf_payment_id has not been fully applied before (idempotency).
 *      "Fully applied" means the ledger row has appliedAt IS NOT NULL.
 *   6. Event timestamp is not older than the newest event already processed
 *      for this farm (clock-skew + retry-queue defence).
 *
 * Wave 4c A11 (Codex 2026-05-02 HIGH, finding #9): the prior version of
 * this handler had none of (4)–(6) and logged the full payfast_token at
 * INFO level. PayFast retries every ITN ≥3 times by spec, so without dedup
 * we mutated subscription state on every retry. A late-arriving FAILED
 * event could clobber a newer COMPLETE state. A leaked rotated token could
 * replay an old subscription back into the live record. All four bugs are
 * addressed here.
 *
 * Issue #95 (2026-05-04): two additional bugs:
 *   A. Insert-before-mutate: the dedup ledger row was inserted BEFORE
 *      updateFarmSubscription ran. If the mutation threw, the row was already
 *      committed — PayFast retries were 200'd as "already processed" and the
 *      tenant never went active (silent revenue loss).
 *   B. PENDING blocks COMPLETE: PayFast sends PENDING then COMPLETE with the
 *      same pf_payment_id. The PENDING insert claimed the unique index so the
 *      later COMPLETE was deduped without ever activating the subscription.
 *
 * Fix: the `appliedAt` column on PayfastEvent tracks whether the subscription
 * mutation completed. NULL = inserted but not yet applied. Non-NULL = fully
 * applied. On P2002 the handler inspects the existing row before deciding
 * whether to treat the retry as a no-op.
 */

/** Mask format used in logs. Keeps a 4-char prefix so support can correlate
 * an alert to a token without exfiltrating the secret. */
function maskToken(token: string | undefined | null): string {
  if (!token) return '(none)';
  if (token.length <= 4) return '***';
  return `${token.slice(0, 4)}***`;
}

/** Constant-time-ish equality so a stale-token attacker can't time-attack
 * the compare. Buffers must be the same length for `timingSafeEqual` — bail
 * fast on length mismatch (length itself is not secret in this protocol). */
function tokensMatch(incoming: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const a = Buffer.from(incoming, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Stable hash of the ITN payload (signature stripped). Recorded with each
 * processed event so an audit can re-derive the request that fired the
 * mutation without storing the raw form-body (which contains the token). */
function hashPayload(params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

/** Parse the optional `timestamp` field that PayFast includes on subscription
 * events. Falls back to "now" if absent or unparseable — the dedup PK still
 * protects us from double-processing; ordering simply degrades to FIFO. */
function parseEventTime(raw: string | undefined): Date {
  if (!raw) return new Date();
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : new Date();
}

/** Status upgrade precedence. Higher number = higher priority.
 * Used to decide whether an incoming event can overwrite an existing row. */
const STATUS_RANK: Record<string, number> = {
  PENDING: 0,
  FAILED: 1,
  CANCELLED: 1,
  COMPLETE: 2,
};

function isStatusUpgrade(incoming: string, existing: string): boolean {
  return (STATUS_RANK[incoming] ?? 0) > (STATUS_RANK[existing] ?? 0);
}

export const POST = publicHandler({
  handle: async (req: NextRequest): Promise<Response> => {
  // 1. Source IP allowlist.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1';

  if (!isValidPayFastIP(ip)) {
    logger.warn('[payfast-itn] Rejected request from IP', { ip });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Parse the POST body (application/x-www-form-urlencoded).
  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const rawParams = Object.fromEntries(new URLSearchParams(body)) as PayFastParams;
  const { signature: receivedSignature, ...paramsWithoutSig } = rawParams;

  if (!receivedSignature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  // 3. Verify signature.
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  const expectedSignature = generateSignature(paramsWithoutSig, passphrase);

  if (expectedSignature !== receivedSignature) {
    logger.warn('[payfast-itn] Signature mismatch', {
      expected: expectedSignature,
      got: receivedSignature,
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 4. Server-to-server ITN validation.
  const isValid = await validateITN(rawParams);
  if (!isValid) {
    logger.warn('[payfast-itn] PayFast ITN validation returned INVALID');
    return NextResponse.json({ error: 'ITN validation failed' }, { status: 400 });
  }

  // 5. Resolve farm + extract idempotency keys.
  const paymentStatus = rawParams.payment_status;
  const farmSlug = rawParams.custom_str1;
  const incomingToken = rawParams.token ?? '';
  const pfPaymentId = rawParams.pf_payment_id;
  const eventTime = parseEventTime(rawParams.timestamp);

  if (!farmSlug) {
    logger.error('[payfast-itn] Missing custom_str1 (farmSlug)');
    return NextResponse.json({ error: 'Missing farm identifier' }, { status: 400 });
  }

  if (!pfPaymentId) {
    // Without pf_payment_id we have no dedup key. Reject explicitly — we
    // would rather have PayFast surface the misconfiguration than silently
    // accept potentially-replayable events.
    logger.warn('[payfast-itn] Missing pf_payment_id', { farmSlug });
    return NextResponse.json({ error: 'Missing pf_payment_id' }, { status: 400 });
  }

  logger.info('[payfast-itn] Received', {
    paymentStatus,
    farmSlug,
    pfPaymentId,
    payfastTokenMask: maskToken(incomingToken),
  });

  // 6. Token check against the farm's currently-stored payfast_token.
  // First-time activation: stored is null → accept (the success branch will
  // persist `incomingToken` via updateFarmSubscription). Subsequent events:
  // mismatch means rotated/stale token — log + return 200 so PayFast stops
  // retrying, but DO NOT mutate subscription state.
  const subscription = await getFarmSubscription(farmSlug);
  if (subscription?.payfastToken && !tokensMatch(incomingToken, subscription.payfastToken)) {
    logger.warn('[payfast-itn] Stale token — event for non-current subscription, dropping', {
      farmSlug,
      pfPaymentId,
      incomingTokenMask: maskToken(incomingToken),
      storedTokenMask: maskToken(subscription.payfastToken),
    });
    // 200 OK with no body — same shape as success path so PayFast's retry
    // queue empties. The event was authentic (signature + ITN-validate
    // passed) but does not apply to the current subscription.
    return new NextResponse(null, { status: 200 });
  }

  // 7. Idempotency + ordering — both enforced inside the tenant DB.
  return await withFarmPrisma(farmSlug, async (db) => {
    // Order check: skip if older than the newest event already on file.
    const newest = await db.payfastEvent.findFirst({
      orderBy: { eventTime: 'desc' },
    });
    if (newest && newest.eventTime.getTime() > eventTime.getTime()) {
      logger.warn('[payfast-itn] Stale event time — newer event already processed', {
        farmSlug,
        pfPaymentId,
        incomingEventTime: eventTime.toISOString(),
        latestProcessedAt: newest.eventTime.toISOString(),
      });
      return new NextResponse(null, { status: 200 });
    }

    // Dedup insert with appliedAt = null (Issue #95 fix — Facets A & B).
    //
    // Insert FIRST to claim the unique slot and prevent concurrent retries
    // from both passing an existence check (the race guard). appliedAt starts
    // as null — it is set AFTER the subscription mutation succeeds.
    //
    // On P2002 (duplicate pfPaymentId) we inspect the existing row:
    //   • appliedAt IS NOT NULL → fully applied, safe no-op.
    //   • appliedAt IS NULL     → prior attempt started but the mutation did
    //                             not complete (DB blip, function timeout, etc).
    //                             Re-run the mutation so the tenant goes active.
    //   • Status upgrade        → incoming COMPLETE supersedes a stored PENDING.
    //                             Re-run the mutation regardless of appliedAt.
    let isRetryAfterFailure = false;
    let isStatusUpgradeCase = false;

    try {
      await db.payfastEvent.create({
        data: {
          pfPaymentId,
          eventTime,
          paymentStatus: paymentStatus ?? '',
          payloadHash: hashPayload(paramsWithoutSig),
          // appliedAt is omitted → defaults to null (not yet applied).
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'P2002') {
        throw err;
      }

      // Duplicate pfPaymentId — inspect the existing row.
      const existing = await db.payfastEvent.findUnique({
        where: { pfPaymentId },
      });

      if (!existing) {
        // Extremely unlikely (row was deleted between the failed insert and
        // this lookup). Treat as fully-applied to avoid infinite loops.
        logger.warn('[payfast-itn] Duplicate but existing row not found — treating as applied', {
          farmSlug,
          pfPaymentId,
        });
        return new NextResponse(null, { status: 200 });
      }

      // Check whether incoming status is a promotion of the stored status.
      const upgrade = isStatusUpgrade(paymentStatus ?? '', existing.paymentStatus);

      if (existing.appliedAt !== null && !upgrade) {
        // Already fully applied and no status upgrade — safe no-op.
        logger.info('[payfast-itn] Duplicate pf_payment_id — already applied, skipping', {
          farmSlug,
          pfPaymentId,
          existingStatus: existing.paymentStatus,
          incomingStatus: paymentStatus,
        });
        return new NextResponse(null, { status: 200 });
      }

      if (upgrade) {
        // Status upgrade (e.g. PENDING → COMPLETE). Update stored status and
        // reset appliedAt to null so the mutation block below runs.
        isStatusUpgradeCase = true;
        logger.warn('[payfast-itn] Status upgrade — re-applying with new status', {
          farmSlug,
          pfPaymentId,
          fromStatus: existing.paymentStatus,
          toStatus: paymentStatus,
        });
        await db.payfastEvent.update({
          where: { pfPaymentId },
          data: {
            paymentStatus: paymentStatus ?? '',
            payloadHash: hashPayload(paramsWithoutSig),
            eventTime,
            appliedAt: null, // reset; will be set after successful mutation
          },
        });
      } else {
        // appliedAt IS NULL and no upgrade — prior attempt's mutation failed.
        // Retry the mutation.
        isRetryAfterFailure = true;
        logger.warn('[payfast-itn] Incomplete-apply detected — retry after failed mutation', {
          farmSlug,
          pfPaymentId,
          paymentStatus,
        });
      }
    }

    // 8. Process the event.
    // Runs when: (a) fresh insert, (b) retry-after-failure, (c) status upgrade.
    if (paymentStatus === 'COMPLETE') {
      const tier = (rawParams.custom_str2 ?? '') as 'basic' | 'advanced' | '';
      const frequency = (rawParams.custom_str3 ?? '') as 'monthly' | 'annual' | '';
      const amountGross = rawParams.amount_gross ?? rawParams.amount;
      const billingAmountZar = amountGross ? Math.round(parseFloat(amountGross)) : undefined;

      // Compute and lock the farm's LSU at subscription time. Catch any
      // error so a DB hiccup doesn't block the ITN response.
      let lockedLsu: number | undefined;
      try {
        const { computeFarmLsu } = await import('@/lib/pricing/farm-lsu');
        lockedLsu = await computeFarmLsu(farmSlug);
      } catch (err) {
        logger.error('[payfast-itn] Failed to compute farm LSU — lockedLsu will be null', err);
      }

      const now = new Date();

      // Only compute nextRenewalAt when we know the billing period.
      let nextRenewalAt: string | undefined;
      if (frequency === 'monthly') {
        const d = new Date(now);
        d.setMonth(d.getMonth() + 1);
        nextRenewalAt = d.toISOString();
      } else if (frequency === 'annual') {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() + 1);
        nextRenewalAt = d.toISOString();
      }

      // Mutation — if this throws the ledger row retains appliedAt = null so
      // PayFast retries will re-enter the retry-after-failure branch above.
      await updateFarmSubscription(farmSlug, 'active', {
        payfastToken: incomingToken || undefined,
        startedAt: now.toISOString(),
        ...(tier === 'basic' || tier === 'advanced' ? { tier } : {}),
        ...(frequency === 'monthly' || frequency === 'annual'
          ? { billingFrequency: frequency }
          : {}),
        ...(billingAmountZar !== undefined ? { billingAmountZar } : {}),
        ...(lockedLsu !== undefined ? { lockedLsu } : {}),
        ...(nextRenewalAt !== undefined ? { nextRenewalAt } : {}),
      });

      // Stamp appliedAt now that the mutation committed.
      await db.payfastEvent.update({
        where: { pfPaymentId },
        data: { appliedAt: now },
      });

      logger.info('[payfast-itn] Subscription activated', {
        farmSlug,
        tier: tier || 'unknown',
        frequency: frequency || 'unknown',
        billingAmountZar,
        lockedLsu,
        payfastTokenMask: maskToken(incomingToken),
        isRetryAfterFailure,
        isStatusUpgradeCase,
      });
    } else if (paymentStatus === 'FAILED' || paymentStatus === 'CANCELLED') {
      await updateFarmSubscription(farmSlug, 'inactive');

      await db.payfastEvent.update({
        where: { pfPaymentId },
        data: { appliedAt: new Date() },
      });

      logger.info('[payfast-itn] Subscription set to inactive', {
        farmSlug,
        paymentStatus,
        payfastTokenMask: maskToken(incomingToken),
        isRetryAfterFailure,
      });
    }
    // PENDING status: no action on the subscription — wait for COMPLETE or FAILED.
    // We do NOT set appliedAt on PENDING so a subsequent COMPLETE for the same
    // pf_payment_id will enter the status-upgrade path and activate the sub.

    // PayFast expects a 200 OK with no body.
    return new NextResponse(null, { status: 200 });
  });
  },
});
