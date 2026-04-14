import crypto from 'crypto';

const SANDBOX = process.env.PAYFAST_SANDBOX === 'true';

export const PAYFAST_URL = SANDBOX
  ? 'https://sandbox.payfast.co.za/eng/process'
  : 'https://www.payfast.co.za/eng/process';

const PAYFAST_VALIDATE_URL = SANDBOX
  ? 'https://sandbox.payfast.co.za/eng/query/validate'
  : 'https://www.payfast.co.za/eng/query/validate';

// Valid source IPs for PayFast ITN notifications
// https://developers.payfast.co.za/docs#notify-url
const PAYFAST_VALID_IPS = [
  // Production
  '41.74.179.194',
  '41.74.179.195',
  '41.74.179.196',
  '41.74.179.197',
  '41.74.179.198',
  // Sandbox (same range used for sandbox testing)
  '196.33.227.224',
  '196.33.227.225',
  '196.33.227.226',
  // Localhost only in development — not in production to prevent IP spoofing
  ...(process.env.NODE_ENV === 'development' ? ['127.0.0.1', '::1'] : []),
];

export type PayFastParams = Record<string, string>;

/**
 * Generate an MD5 signature for PayFast params.
 * Params are sorted alphabetically, URL-encoded (PHP-style: spaces as +),
 * joined with &. Passphrase appended if provided.
 */
export function generateSignature(params: PayFastParams, passphrase?: string): string {
  const sorted = Object.keys(params)
    .sort()
    .filter((key) => params[key] !== '');

  const parts = sorted.map((key) => {
    const encoded = encodeURIComponent(params[key]).replace(/%20/g, '+');
    return `${key}=${encoded}`;
  });

  let str = parts.join('&');

  if (passphrase) {
    const encodedPass = encodeURIComponent(passphrase).replace(/%20/g, '+');
    str += `&passphrase=${encodedPass}`;
  }

  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Check whether an IP address is a valid PayFast server IP.
 */
export function isValidPayFastIP(ip: string): boolean {
  return PAYFAST_VALID_IPS.includes(ip);
}

/**
 * Perform server-side ITN validation by posting params back to PayFast.
 * Returns true only if PayFast responds with "VALID".
 */
export async function validateITN(params: PayFastParams): Promise<boolean> {
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  try {
    const res = await fetch(PAYFAST_VALIDATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'FarmTrack/1.0',
      },
      body,
    });
    const text = await res.text();
    return text.trim() === 'VALID';
  } catch (err) {
    console.error('[payfast] ITN validation request failed:', err);
    return false;
  }
}

export interface BuildSubscriptionOpts {
  /** Pricing tier being subscribed to. */
  tier: 'basic' | 'advanced';
  /**
   * Amount in whole ZAR (no decimals). Must be an integer. Compute via
   * lib/pricing/calculator.ts quoteTier() before passing here.
   */
  amountZar: number;
  /** Billing frequency. Determines PayFast frequency code (3=monthly, 6=annual). */
  frequency: 'monthly' | 'annual';
  farmSlug: string;
  farmDisplayName: string;
  userEmail: string;
  userFirstName: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}

const PAYFAST_FREQUENCY_CODE: Record<BuildSubscriptionOpts['frequency'], string> = {
  monthly: '3',
  annual:  '6',
};

function formatAmount(zar: number): string {
  if (!Number.isInteger(zar)) throw new Error('amountZar must be an integer (no decimals)');
  return `${zar}.00`;
}

/**
 * Build params for a PayFast recurring subscription form POST.
 *
 * Does NOT add the signature — callers must call generateSignature() and
 * attach the result as params.signature before rendering the form.
 *
 * custom_str1 = farmSlug     (for ITN farm identification)
 * custom_str2 = tier         (for ITN tier persistence)
 * custom_str3 = frequency    (for ITN billing-period persistence)
 * custom_str4 = farmDisplayName (for PayFast receipt display)
 */
export function buildSubscriptionParams(opts: BuildSubscriptionOpts): PayFastParams {
  const merchantId = process.env.PAYFAST_MERCHANT_ID ?? '';
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY ?? '';

  const tierLabel = opts.tier === 'basic' ? 'Basic' : 'Advanced';
  const freqLabel = opts.frequency === 'monthly' ? 'Monthly' : 'Annual';
  const amount = formatAmount(opts.amountZar);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  return {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: opts.returnUrl,
    cancel_url: opts.cancelUrl,
    notify_url: opts.notifyUrl,
    name_first: opts.userFirstName,
    email_address: opts.userEmail,
    amount,
    item_name: `FarmTrack ${tierLabel} — ${freqLabel}`,
    subscription_type: '1',
    billing_date: today,
    recurring_amount: amount,
    frequency: PAYFAST_FREQUENCY_CODE[opts.frequency],
    cycles: '0',
    custom_str1: opts.farmSlug,
    custom_str2: opts.tier,
    custom_str3: opts.frequency,
    custom_str4: opts.farmDisplayName,
  };
}
