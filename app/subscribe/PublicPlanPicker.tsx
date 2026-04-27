import Link from 'next/link';

/**
 * Public plan picker rendered at /subscribe for anonymous visitors.
 *
 * Why this exists: P2 stress-test discovered that hitting /subscribe with
 * no session 307'd to /login — a dead end for prospects who arrived from
 * marketing copy, a shared URL, or a bookmark. Phase B's
 * /subscribe/complete fix established the rule: fast-fail to something
 * useful, never trap users in a login wall they can't satisfy.
 *
 * The CTAs link to `/register?tier=<slug>`. That matches the query
 * pattern the marketing site already uses in
 * `farm-website-v2/components/pricing/LsuPricingCalculator.tsx` and
 * `components/home/FinalCTA.tsx`. The register page itself (W2's
 * territory) is responsible for picking the tier up — we only have to
 * pass the param.
 *
 * No client-side JS, no session check, no DB calls — purely a static
 * server-rendered surface. Safe to render anywhere this file is imported.
 */

type PlanTier = {
  slug: 'basic' | 'advanced' | 'consulting';
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  bullets: string[];
  highlighted?: boolean;
};

const PLANS: PlanTier[] = [
  {
    slug: 'basic',
    name: 'Basic',
    price: 'R200',
    cadence: 'per month',
    blurb: 'Run the day-to-day farm in one place.',
    bullets: [
      'Unlimited animal records',
      'Camp & grazing management',
      'Health & observation logs',
      'Mobile-ready, works offline',
    ],
  },
  {
    slug: 'advanced',
    name: 'Advanced',
    price: 'R450',
    cadence: 'per month',
    blurb: 'Everything in Basic + insight that compounds.',
    bullets: [
      'Reproduction & breeding analytics',
      'Performance charts & KPIs',
      'Tasks, scheduling & alerts',
      'Priority support',
    ],
    highlighted: true,
  },
  {
    slug: 'consulting',
    name: 'Consulting',
    price: 'Custom',
    cadence: 'per farm',
    blurb: 'Hands-on setup, audits and advisory.',
    bullets: [
      'Onboarding & data migration',
      'Quarterly farm-health audits',
      'Direct line to a specialist',
      'Tailored to your operation',
    ],
  },
];

export default function PublicPlanPicker() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 py-10"
      style={{ background: '#1A1510' }}
    >
      <div className="w-full max-w-5xl flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2.5">
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '9px',
                background: 'linear-gradient(135deg, #C49030 0%, #8B5E14 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 12 L8 4 L13 12"
                  stroke="#F0DEB8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M5.5 9 L10.5 9" stroke="#F0DEB8" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                color: '#F0DEB8',
                fontSize: '1.25rem',
                fontWeight: 700,
              }}
            >
              FarmTrack
            </span>
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              color: '#F0DEB8',
              fontSize: '2rem',
              fontWeight: 700,
              lineHeight: 1.15,
              marginTop: '0.25rem',
            }}
          >
            Pick a plan to get started
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              color: '#8A6840',
              fontSize: '0.9375rem',
              maxWidth: '32rem',
            }}
          >
            Create your account, set up your farm, and you&apos;re ready to log
            animals on the same day. Cancel any time.
          </p>
        </div>

        {/* Plan grid */}
        <div
          className="grid gap-5"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          {PLANS.map((plan) => (
            <div
              key={plan.slug}
              style={{
                borderRadius: '1.25rem',
                background: '#241C14',
                border: plan.highlighted
                  ? '1px solid rgba(196,144,48,0.45)'
                  : '1px solid rgba(196,144,48,0.18)',
                boxShadow: plan.highlighted
                  ? '0 0 48px rgba(196,144,48,0.10), 0 8px 40px rgba(0,0,0,0.55)'
                  : '0 8px 32px rgba(0,0,0,0.45)',
                padding: '1.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div className="flex items-baseline justify-between">
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    color: '#F0DEB8',
                    fontSize: '1.25rem',
                    fontWeight: 700,
                  }}
                >
                  {plan.name}
                </h2>
                {plan.highlighted && (
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      background: 'rgba(196,144,48,0.18)',
                      color: '#C49030',
                      border: '1px solid rgba(196,144,48,0.30)',
                      borderRadius: '999px',
                      padding: '2px 8px',
                      fontFamily: 'var(--font-sans)',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Most popular
                  </span>
                )}
              </div>

              <div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      color: '#C49030',
                      fontSize: '1.875rem',
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    {plan.price}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      color: '#8A6840',
                      fontSize: '0.8125rem',
                    }}
                  >
                    {plan.cadence}
                  </span>
                </div>
                <p
                  style={{
                    fontFamily: 'var(--font-sans)',
                    color: '#B0946A',
                    fontSize: '0.875rem',
                    marginTop: '0.5rem',
                  }}
                >
                  {plan.blurb}
                </p>
              </div>

              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                {plan.bullets.map((bullet) => (
                  <li
                    key={bullet}
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
                      <polyline
                        points="2 7 5.5 10.5 12 4"
                        stroke="#4A7C59"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {bullet}
                  </li>
                ))}
              </ul>

              <div style={{ marginTop: 'auto', paddingTop: '0.5rem' }}>
                <Link
                  href={`/register?tier=${plan.slug}`}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'center',
                    background: plan.highlighted
                      ? 'linear-gradient(135deg, rgba(196,144,48,0.92) 0%, rgba(160,100,40,0.92) 100%)'
                      : 'rgba(196,144,48,0.12)',
                    border: '1px solid rgba(196,144,48,0.35)',
                    borderRadius: '10px',
                    padding: '0.75rem',
                    color: plan.highlighted ? '#F0DEB8' : '#C49030',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                    letterSpacing: '0.01em',
                  }}
                >
                  {plan.slug === 'consulting'
                    ? 'Talk to us'
                    : `Start with ${plan.name}`}
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Sign-in escape hatch */}
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            color: '#8A6840',
            fontSize: '0.875rem',
            textAlign: 'center',
          }}
        >
          Already have an account?{' '}
          <Link
            href="/login"
            style={{
              color: '#C49030',
              textDecoration: 'underline',
              textUnderlineOffset: '3px',
            }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
