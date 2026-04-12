import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { buildSubscriptionParams, generateSignature, PAYFAST_URL } from '@/lib/payfast';
import { getFarmSubscription } from '@/lib/meta-db';

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ farm?: string; cancelled?: string }>;
}) {
  const { farm: farmSlugParam, cancelled } = await searchParams;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect('/login');
  }

  // Identify which farm to subscribe (from proxy redirect param, or first unpaid basic farm)
  const farmSlug =
    farmSlugParam ??
    session.user.farms.find(
      (f) => f.tier === 'basic' && f.subscriptionStatus !== 'active',
    )?.slug;

  if (!farmSlug) {
    redirect('/farms');
  }

  const farm = session.user.farms.find((f) => f.slug === farmSlug);
  if (!farm || !session.user.email) {
    redirect('/farms');
  }

  // Double-check live DB status (JWT may be stale)
  const sub = await getFarmSubscription(farmSlug);
  if (sub?.subscriptionStatus === 'active') {
    redirect(`/${farmSlug}/admin`);
  }

  // Build PayFast params server-side — secrets never leave the server
  const appUrl = (process.env.NEXTAUTH_URL ?? 'https://farm-management-lilac.vercel.app').replace(
    /\/$/,
    '',
  );

  const pfParams = buildSubscriptionParams({
    farmSlug,
    farmDisplayName: farm.displayName,
    userEmail: session.user.email,
    userFirstName: session.user.name ?? session.user.username,
    returnUrl: `${appUrl}/subscribe/complete?farm=${farmSlug}`,
    cancelUrl: `${appUrl}/subscribe?farm=${farmSlug}&cancelled=true`,
    notifyUrl: `${appUrl}/api/webhooks/payfast`,
  });

  const passphrase = process.env.PAYFAST_PASSPHRASE;
  pfParams.signature = generateSignature(pfParams, passphrase);

  const isCancelled = cancelled === 'true';
  const sandboxMode = process.env.PAYFAST_SANDBOX === 'true';

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
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #C49030 0%, #8B5E14 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 12 L8 4 L13 12" stroke="#F0DEB8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.5 9 L10.5 9" stroke="#F0DEB8" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <span style={{ fontFamily: 'var(--font-display)', color: '#F0DEB8', fontSize: '1.1rem', fontWeight: 700 }}>
            FarmTrack
          </span>
          {sandboxMode && (
            <span
              style={{
                fontSize: '0.6875rem',
                background: 'rgba(196,144,48,0.15)',
                color: '#C49030',
                border: '1px solid rgba(196,144,48,0.25)',
                borderRadius: '4px',
                padding: '1px 6px',
                fontFamily: 'var(--font-sans)',
              }}
            >
              SANDBOX
            </span>
          )}
        </div>

        {/* Cancelled notice */}
        {isCancelled && (
          <div
            style={{
              background: 'rgba(200,100,60,0.1)',
              border: '1px solid rgba(200,100,60,0.25)',
              borderRadius: '10px',
              padding: '0.75rem 1rem',
              color: '#E07060',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.875rem',
            }}
          >
            Payment was cancelled. You can try again below.
          </div>
        )}

        {/* Heading */}
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
            Activate Basic Plan
          </h1>
          <p style={{ fontFamily: 'var(--font-sans)', color: '#8A6840', fontSize: '0.875rem' }}>
            {farm.displayName}
          </p>
        </div>

        {/* Pricing card */}
        <div
          style={{
            background: 'rgba(196,144,48,0.06)',
            border: '1px solid rgba(196,144,48,0.18)',
            borderRadius: '14px',
            padding: '1.25rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <p style={{ fontFamily: 'var(--font-sans)', color: '#F0DEB8', fontSize: '0.9375rem', fontWeight: 500 }}>
              Basic Plan
            </p>
            <p style={{ fontFamily: 'var(--font-sans)', color: '#8A6840', fontSize: '0.8125rem', marginTop: '2px' }}>
              Monthly subscription · Cancel anytime
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontFamily: 'var(--font-display)', color: '#C49030', fontSize: '1.5rem', fontWeight: 700 }}>
              R200
            </p>
            <p style={{ fontFamily: 'var(--font-sans)', color: '#8A6840', fontSize: '0.75rem' }}>
              per month
            </p>
          </div>
        </div>

        {/* What's included */}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            'Unlimited animal records',
            'Camp & grazing management',
            'Health & observation logs',
            'Import & export tools',
            'Mobile-ready, works offline',
          ].map((item) => (
            <li
              key={item}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                fontFamily: 'var(--font-sans)',
                color: '#B0946A',
                fontSize: '0.875rem',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <polyline points="2 7 5.5 10.5 12 4" stroke="#4A7C59" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {item}
            </li>
          ))}
        </ul>

        {/* PayFast form */}
        <form method="POST" action={PAYFAST_URL}>
          {Object.entries(pfParams).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <button
            type="submit"
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)',
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

        <p style={{ fontFamily: 'var(--font-sans)', color: '#5A4030', fontSize: '0.75rem', textAlign: 'center' }}>
          Secured by PayFast · Your card details are never stored by FarmTrack
        </p>
      </div>
    </div>
  );
}
