import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { computeFarmLsu } from '@/lib/pricing/farm-lsu';
import { quoteTier } from '@/lib/pricing/calculator';
import { buildSubscriptionParams, generateSignature, PAYFAST_URL } from '@/lib/payfast';

export const dynamic = 'force-dynamic';

export default async function SubscribeUpgradePage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams: Promise<{ frequency?: string }>;
}) {
  const { farmSlug } = await params;
  const sp = await searchParams;
  const frequency: 'monthly' | 'annual' =
    sp.frequency === 'annual' ? 'annual' : 'monthly';

  // Auth
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const farm = session.user.farms.find((f) => f.slug === farmSlug);
  if (!farm || !session.user.email) redirect('/farms');

  // Already Advanced? Skip upgrade
  if (farm.tier === 'advanced') {
    redirect(`/${farmSlug}/admin/settings/subscription`);
  }

  // Compute live quote — must be an integer (assertValidLsu enforces this)
  let lsu = 100; // safe default if computation fails
  try {
    const rawLsu = await computeFarmLsu(farmSlug);
    lsu = Math.round(rawLsu);
  } catch {
    // non-critical — use default
  }
  // Ensure lsu is at least 1 (avoids base-only pricing for empty farms)
  if (lsu < 1) lsu = 1;

  const quote = quoteTier('advanced', lsu);
  const amountZar = frequency === 'annual' ? quote.annualZar : quote.monthlyZar;

  // Build PayFast form
  const appUrl = (process.env.NEXTAUTH_URL ?? 'https://farm-management-lilac.vercel.app').replace(
    /\/$/,
    '',
  );
  const pfParams = buildSubscriptionParams({
    tier: 'advanced',
    amountZar,
    frequency,
    farmSlug,
    farmDisplayName: farm.displayName,
    userEmail: session.user.email,
    userFirstName: session.user.name ?? session.user.username ?? 'Farmer',
    returnUrl: `${appUrl}/${farmSlug}/subscribe/upgrade/return`,
    cancelUrl: `${appUrl}/${farmSlug}/subscribe/upgrade/cancel`,
    notifyUrl: `${appUrl}/api/webhooks/payfast`,
  });
  pfParams.signature = generateSignature(pfParams, process.env.PAYFAST_PASSPHRASE);

  const sandboxMode = process.env.PAYFAST_SANDBOX === 'true';
  const savingPct = Math.max(
    0,
    Math.round(((quote.monthlyZar * 12 - quote.annualZar) / (quote.monthlyZar * 12)) * 100),
  );

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5"
      style={{ background: '#1A1510' }}
    >
      <div
        className="w-full max-w-md px-8 py-10 flex flex-col gap-6"
        style={{
          borderRadius: '2rem',
          background: '#241C14',
          border: '1px solid rgba(196,144,48,0.18)',
          boxShadow: '0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)',
        }}
      >
        {/* Header */}
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              color: '#F0DEB8',
              fontSize: '1.5rem',
              fontWeight: 700,
              marginBottom: '0.375rem',
            }}
          >
            Upgrade to Advanced
          </h1>
          <p style={{ fontFamily: 'var(--font-sans)', color: '#8A6840', fontSize: '0.875rem' }}>
            {farm.displayName} &middot; {lsu} LSU
          </p>
          {sandboxMode && (
            <span
              style={{
                display: 'inline-block',
                marginTop: '4px',
                fontSize: '0.6875rem',
                background: 'rgba(196,144,48,0.15)',
                color: '#C49030',
                border: '1px solid rgba(196,144,48,0.25)',
                borderRadius: '4px',
                padding: '1px 6px',
              }}
            >
              SANDBOX
            </span>
          )}
        </div>

        {/* Frequency toggle */}
        <div
          style={{
            display: 'flex',
            borderRadius: '10px',
            overflow: 'hidden',
            border: '1px solid rgba(196,144,48,0.2)',
          }}
        >
          {(['monthly', 'annual'] as const).map((f) => (
            <a
              key={f}
              href={`/${farmSlug}/subscribe/upgrade?frequency=${f}`}
              style={{
                flex: 1,
                padding: '0.5rem',
                textAlign: 'center',
                fontSize: '0.8125rem',
                fontWeight: 600,
                textDecoration: 'none',
                background: frequency === f ? 'rgba(196,144,48,0.15)' : 'transparent',
                color: frequency === f ? '#C49030' : '#6B5E50',
                transition: 'background 0.15s',
              }}
            >
              {f === 'monthly' ? 'Monthly' : `Annual${savingPct > 0 ? ` (save ${savingPct}%)` : ''}`}
            </a>
          ))}
        </div>

        {/* Price card */}
        <div
          style={{
            background: 'rgba(196,144,48,0.06)',
            border: '1px solid rgba(196,144,48,0.18)',
            borderRadius: '14px',
            padding: '1.25rem 1.5rem',
          }}
        >
          <p style={{ fontFamily: 'var(--font-sans)', color: '#8A6840', fontSize: '0.8125rem' }}>
            Advanced Plan &middot; {frequency === 'monthly' ? 'Monthly' : 'Annual'}
          </p>
          <p
            style={{
              fontFamily: 'var(--font-display)',
              color: '#C49030',
              fontSize: '2rem',
              fontWeight: 700,
              marginTop: '4px',
            }}
          >
            {frequency === 'monthly' ? quote.monthlyFormatted : quote.annualFormatted}
            <span
              style={{
                fontSize: '0.9375rem',
                fontWeight: 400,
                color: '#8A6840',
                marginLeft: '4px',
              }}
            >
              /{frequency === 'monthly' ? 'mo' : 'yr'}
            </span>
          </p>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              color: '#6B5E50',
              fontSize: '0.75rem',
              marginTop: '4px',
            }}
          >
            LSU locked at {lsu} for this billing period
          </p>
        </div>

        {/* PayFast form */}
        <form method="POST" action={PAYFAST_URL}>
          {Object.entries(pfParams).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <button
            type="submit"
            style={{
              width: '100%',
              background:
                'linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)',
              border: '1px solid rgba(196,144,48,0.35)',
              borderRadius: '10px',
              padding: '0.875rem',
              color: '#F0DEB8',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: '0.01em',
            }}
          >
            Proceed to Payment
          </button>
        </form>

        <p
          style={{
            fontFamily: 'var(--font-sans)',
            color: '#5A4030',
            fontSize: '0.75rem',
            textAlign: 'center',
          }}
        >
          Secured by PayFast &middot; Cancel anytime
        </p>
      </div>
    </div>
  );
}
