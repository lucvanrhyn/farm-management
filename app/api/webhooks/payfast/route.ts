import { NextRequest, NextResponse } from 'next/server';
import {
  generateSignature,
  isValidPayFastIP,
  validateITN,
  type PayFastParams,
} from '@/lib/payfast';
import { updateFarmSubscription } from '@/lib/meta-db';

/**
 * PayFast ITN (Instant Transaction Notification) webhook.
 * PayFast POSTs to this endpoint after a payment event.
 *
 * Validation steps:
 * 1. Source IP must be a known PayFast IP
 * 2. Signature must match our regenerated signature
 * 3. Server-side validate via PayFast's validate endpoint
 * 4. payment_status must be COMPLETE
 */
export async function POST(req: NextRequest) {
  // 1. Check source IP
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1';

  if (!isValidPayFastIP(ip)) {
    console.warn('[payfast-itn] Rejected request from IP:', ip);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Parse the POST body (application/x-www-form-urlencoded)
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

  // 3. Verify signature
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  const expectedSignature = generateSignature(paramsWithoutSig, passphrase);

  if (expectedSignature !== receivedSignature) {
    console.warn('[payfast-itn] Signature mismatch. Expected:', expectedSignature, 'Got:', receivedSignature);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 4. Server-to-server validation
  const isValid = await validateITN(rawParams);
  if (!isValid) {
    console.warn('[payfast-itn] PayFast ITN validation returned INVALID');
    return NextResponse.json({ error: 'ITN validation failed' }, { status: 400 });
  }

  // 5. Process the event
  const paymentStatus = rawParams.payment_status;
  const farmSlug = rawParams.custom_str1;
  const payfastToken = rawParams.token; // Subscription token for recurring billing

  if (!farmSlug) {
    console.error('[payfast-itn] Missing custom_str1 (farmSlug)');
    return NextResponse.json({ error: 'Missing farm identifier' }, { status: 400 });
  }

  console.info('[payfast-itn] Received:', { paymentStatus, farmSlug, payfastToken });

  if (paymentStatus === 'COMPLETE') {
    const tier = (rawParams.custom_str2 ?? '') as 'basic' | 'advanced' | '';
    const frequency = (rawParams.custom_str3 ?? '') as 'monthly' | 'annual' | '';
    const amountGross = rawParams.amount_gross ?? rawParams.amount;
    const billingAmountZar = amountGross ? Math.round(parseFloat(amountGross)) : undefined;

    // Compute and lock the farm's LSU at subscription time.
    // Catch any error so a DB hiccup doesn't block the ITN response.
    let lockedLsu: number | undefined;
    try {
      const { computeFarmLsu } = await import('@/lib/pricing/farm-lsu');
      lockedLsu = await computeFarmLsu(farmSlug);
    } catch (err) {
      console.error('[payfast-itn] Failed to compute farm LSU — lockedLsu will be null:', err);
    }

    const now = new Date();

    // Only compute nextRenewalAt when we know the billing period.
    // An absent custom_str3 (empty frequency) means we don't know —
    // skip the field rather than silently persisting the wrong renewal date.
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

    await updateFarmSubscription(farmSlug, 'active', {
      payfastToken: payfastToken || undefined,
      startedAt: now.toISOString(),
      ...(tier === 'basic' || tier === 'advanced' ? { tier } : {}),
      ...(frequency === 'monthly' || frequency === 'annual' ? { billingFrequency: frequency } : {}),
      ...(billingAmountZar !== undefined ? { billingAmountZar } : {}),
      ...(lockedLsu !== undefined ? { lockedLsu } : {}),
      ...(nextRenewalAt !== undefined ? { nextRenewalAt } : {}),
    });

    console.info('[payfast-itn] Subscription activated for farm:', farmSlug, {
      tier: tier || 'unknown',
      frequency: frequency || 'unknown',
      billingAmountZar,
      lockedLsu,
    });
  } else if (paymentStatus === 'FAILED' || paymentStatus === 'CANCELLED') {
    await updateFarmSubscription(farmSlug, 'inactive');
    console.info('[payfast-itn] Subscription set to inactive for farm:', farmSlug, '— status:', paymentStatus);
  }
  // PENDING status: no action — wait for COMPLETE or FAILED

  // PayFast expects a 200 OK with no body
  return new NextResponse(null, { status: 200 });
}
