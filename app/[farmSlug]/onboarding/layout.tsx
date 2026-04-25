import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import { StepperFromPathname } from "@/components/onboarding/Stepper";
import { ONBOARDING_GLOW } from "@/components/onboarding/theme";


// ---------------------------------------------------------------------------
// Early-exit panels — stay inline so the server layout is self-contained.
// ---------------------------------------------------------------------------

function ShellFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: ONBOARDING_GLOW }}
    >
      <Horizon />
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col px-5 py-10 md:px-6">
        <WizardMasthead />
        {children}
      </div>
    </div>
  );
}

function Horizon() {
  // Decorative "golden-hour" glow fixed to the viewport — server-rendered
  // with zero JS so it shows instantly on the first paint.
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[70vh]"
      style={{
        background: `
          radial-gradient(ellipse 120% 60% at 50% 0%, rgba(229,185,100,0.10) 0%, transparent 55%),
          radial-gradient(ellipse 60% 35% at 15% 30%, rgba(160,82,45,0.08) 0%, transparent 60%)
        `,
      }}
    />
  );
}

function WizardMasthead() {
  return (
    <header className="relative flex flex-col items-center gap-1.5 pb-2 pt-2 text-center">
      <span
        className="text-[10.5px] uppercase tracking-[0.28em]"
        style={{
          color: "#7A4E20",
          fontFamily: "var(--font-sans)",
        }}
      >
        The FarmTrack ledger
      </span>
      <h1
        style={{
          color: "#F5EBD4",
          fontFamily: "var(--font-display)",
          fontSize: "2.1rem",
          fontWeight: 700,
          letterSpacing: "-0.01em",
          lineHeight: 1.05,
        }}
      >
        FarmTrack
      </h1>
      <span
        className="mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em]"
        style={{
          color: "#C49030",
          borderColor: "rgba(196,144,48,0.35)",
          background: "rgba(36,28,20,0.55)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-full"
          style={{
            background: "#E5B964",
            boxShadow: "0 0 6px rgba(229,185,100,0.8)",
          }}
        />
        Onboarding · Chapter 01
      </span>
    </header>
  );
}

function InfoCard({
  title,
  message,
  linkHref,
  linkLabel,
}: {
  title: string;
  message: string;
  linkHref: string;
  linkLabel: string;
}) {
  return (
    <div
      className="mt-8 flex flex-col items-center gap-4 overflow-hidden rounded-[2rem] px-8 py-10 text-center"
      style={{
        background:
          "linear-gradient(180deg, #2C2218 0%, #241C14 100%)",
        border: "1px solid rgba(196,144,48,0.22)",
        boxShadow:
          "0 1px 0 rgba(245,235,212,0.04) inset, 0 12px 40px rgba(0,0,0,0.55)",
      }}
    >
      <div
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full"
        style={{
          background: "rgba(196,144,48,0.12)",
          border: "1px solid rgba(196,144,48,0.35)",
          color: "#E5B964",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      </div>
      <h2
        style={{
          color: "#F5EBD4",
          fontFamily: "var(--font-display)",
          fontSize: "1.4rem",
          fontWeight: 700,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          color: "#C9B48A",
          fontFamily: "var(--font-sans)",
          fontSize: "0.9375rem",
          lineHeight: 1.55,
          maxWidth: "30rem",
        }}
      >
        {message}
      </p>
      <Link
        href={linkHref}
        className="group mt-1 inline-flex items-center gap-2"
        style={{
          color: "#E5B964",
          fontFamily: "var(--font-sans)",
          fontSize: "0.9rem",
          fontWeight: 500,
        }}
      >
        {linkLabel}
        <span
          aria-hidden="true"
          className="inline-block transition-transform duration-200 group-hover:translate-x-1"
        >
          →
        </span>
      </Link>
    </div>
  );
}

function UnauthenticatedPanel() {
  return (
    <ShellFrame>
      <InfoCard
        title="Check your email"
        message="Verify your email and sign in to pick up the onboarding wizard right where we left it. Your species choice and any uploaded file stay on this device until you commit."
        linkHref="/login"
        linkLabel="Go to sign in"
      />
    </ShellFrame>
  );
}

function NotAdminPanel({ farmSlug }: { farmSlug: string }) {
  return (
    <ShellFrame>
      <InfoCard
        title="Admin access required"
        message="Only an admin can run initial onboarding. Ask the farm owner to sign in and complete setup — you'll see the populated farm once they're done."
        linkHref={`/${farmSlug}/home`}
        linkLabel="Back to your home"
      />
    </ShellFrame>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export default async function OnboardingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  // 1. Auth check.
  const session = await getServerSession(authOptions);
  if (!session) {
    return <UnauthenticatedPanel />;
  }

  // 2. Tenant + role check.
  const result = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in result) {
    if (result.status === 403) {
      return <NotAdminPanel farmSlug={farmSlug} />;
    }
    redirect("/login");
  }

  const { prisma, role } = result;
  if (role !== "ADMIN") {
    return <NotAdminPanel farmSlug={farmSlug} />;
  }

  // 3. Empty-farm guard.
  // cross-species by design: onboarding wizard is "first animal of any kind"
  const animalCount = await prisma.animal.count();
  if (animalCount > 0) {
    redirect(`/${farmSlug}/admin`);
  }

  // 4. Render wizard shell.
  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: ONBOARDING_GLOW }}
    >
      <Horizon />
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col px-5 pb-16 pt-10 md:px-6">
        <WizardMasthead />
        <OnboardingProvider>
          <StepperFromPathname />
          <div className="mt-2">{children}</div>
        </OnboardingProvider>
      </div>
    </div>
  );
}
