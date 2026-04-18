import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import { StepperFromPathname } from "@/components/onboarding/Stepper";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Small inline panels for the three early-exit cases.
// Kept in-file so the layout is self-contained (the other wizard authors own
// their own files per the task split).
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: "#1A1510" }}>
      <div className="max-w-3xl mx-auto px-5 py-10">
        <div className="flex flex-col items-center gap-1 mb-4">
          <h1
            style={{
              fontFamily: "var(--font-display)",
              color: "#F0DEB8",
              fontSize: "2rem",
              fontWeight: 700,
              letterSpacing: "0.01em",
            }}
          >
            FarmTrack
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#6A4E30",
              fontSize: "0.75rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Onboarding
          </p>
        </div>
        {children}
      </div>
    </div>
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
      className="mt-6 px-8 py-8 flex flex-col items-center gap-4 text-center"
      style={{
        borderRadius: "2rem",
        background: "#241C14",
        border: "1px solid rgba(196,144,48,0.18)",
        boxShadow: "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
      }}
    >
      <h2
        style={{
          fontFamily: "var(--font-display)",
          color: "#F0DEB8",
          fontSize: "1.25rem",
          fontWeight: 700,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          color: "#8A6840",
          fontSize: "0.875rem",
          lineHeight: 1.5,
          maxWidth: "28rem",
        }}
      >
        {message}
      </p>
      <Link
        href={linkHref}
        style={{
          marginTop: "0.5rem",
          color: "#C49030",
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          textDecoration: "underline",
        }}
      >
        {linkLabel}
      </Link>
    </div>
  );
}

function UnauthenticatedPanel() {
  return (
    <Shell>
      <InfoCard
        title="Check your email"
        message="You need to verify your email and sign in before continuing onboarding. Follow the verification link we sent, then sign in to pick up where you left off."
        linkHref="/login"
        linkLabel="Go to sign in"
      />
    </Shell>
  );
}

function NotAdminPanel({ farmSlug }: { farmSlug: string }) {
  return (
    <Shell>
      <InfoCard
        title="Admin access required"
        message="Only an admin can run the initial farm onboarding. Ask the farm owner to sign in and complete setup, then you'll be able to join."
        linkHref={`/${farmSlug}/home`}
        linkLabel="Back to your home"
      />
    </Shell>
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

  // 2. Tenant + role check. Use slug-scoped helper because [farmSlug] is in
  //    the URL — the cookie-based helper would miss URL/cookie mismatches.
  const result = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in result) {
    if (result.status === 403) {
      return <NotAdminPanel farmSlug={farmSlug} />;
    }
    // Any other failure (invalid slug, farm not found) — fall back to login.
    redirect("/login");
  }

  const { prisma, role } = result;
  if (role !== "ADMIN") {
    return <NotAdminPanel farmSlug={farmSlug} />;
  }

  // 3. Empty-farm guard: if animals already exist, the wizard is a no-op.
  const animalCount = await prisma.animal.count();
  if (animalCount > 0) {
    redirect(`/${farmSlug}/admin`);
  }

  // 4. Render wizard shell.
  return (
    <div className="min-h-screen" style={{ background: "#1A1510" }}>
      <div className="max-w-3xl mx-auto px-5 py-10">
        <div className="flex flex-col items-center gap-1">
          <h1
            style={{
              fontFamily: "var(--font-display)",
              color: "#F0DEB8",
              fontSize: "2rem",
              fontWeight: 700,
              letterSpacing: "0.01em",
            }}
          >
            FarmTrack
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#6A4E30",
              fontSize: "0.75rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Onboarding
          </p>
        </div>

        <OnboardingProvider>
          <StepperFromPathname />
          <div className="mt-4">{children}</div>
        </OnboardingProvider>
      </div>
    </div>
  );
}
