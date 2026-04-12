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

/**
 * Build the params object for a Basic plan recurring subscription.
 * Caller must add the signature after calling this.
 */
export function buildSubscriptionParams(opts: {
  farmSlug: string;
  farmDisplayName: string;
  userEmail: string;
  userFirstName: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}): PayFastParams {
  const merchantId = process.env.PAYFAST_MERCHANT_ID ?? '';
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY ?? '';

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  return {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: opts.returnUrl,
    cancel_url: opts.cancelUrl,
    notify_url: opts.notifyUrl,
    name_first: opts.userFirstName,
    email_address: opts.userEmail,
    amount: '200.00',
    item_name: 'FarmTrack Basic — Monthly Subscription',
    // Recurring subscription
    subscription_type: '1',
    billing_date: today,
    recurring_amount: '200.00',
    frequency: '3', // Monthly
    cycles: '0',    // Indefinite
    // Map payment back to farm
    custom_str1: opts.farmSlug,
    custom_str2: opts.farmDisplayName,
  };
}
