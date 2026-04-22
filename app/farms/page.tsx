import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import type { SessionFarm } from "@/types/next-auth";
import { FarmCard } from "./FarmCard";
import { getOverviewForUserFarms } from "@/lib/server/multi-farm-overview";
import type { FarmOverview } from "@/lib/server/multi-farm-overview";
import { getCachedMultiFarmOverview } from "@/lib/server/cached";
import { isCacheEnabled } from "@/lib/flags";

// ── Overview loader (only rendered for 2+ farms) ──────────────────────────────

async function OverviewCards({ userId, farms }: { userId: string; farms: SessionFarm[] }) {
  const overviews = isCacheEnabled(farms[0]?.slug ?? "")
    ? await getCachedMultiFarmOverview(userId, farms)
    : await getOverviewForUserFarms(farms);
  const overviewBySlug = Object.fromEntries(overviews.map((o) => [o.slug, o]));

  return (
    <>
      {farms.map((farm, i) => (
        <FarmCard
          key={farm.slug}
          farm={farm}
          index={i}
          overview={overviewBySlug[farm.slug]}
        />
      ))}
    </>
  );
}

// ── Skeleton fallback for multi-farm overview load ────────────────────────────

function CardSkeletons({ farms }: { farms: SessionFarm[] }) {
  return (
    <>
      {farms.map((farm, i) => (
        <FarmCard key={farm.slug} farm={farm} index={i} />
      ))}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function FarmsPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const farms: SessionFarm[] = session.user.farms ?? [];
  const isMultiFarm = farms.length >= 2;
  const userId = session.user.id ?? session.user.email ?? "unknown";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 relative overflow-hidden"
      style={{ background: "#1A1510" }}
    >
      {/* Radial amber glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 55%, rgba(196,144,48,0.09) 0%, transparent 70%)",
          zIndex: 1,
        }}
      />

      <div
        className="relative w-full max-w-lg flex flex-col items-center gap-8"
        style={{ zIndex: 10 }}
      >
        {/* Heading */}
        <div className="flex flex-col items-center gap-2 text-center">
          <h1
            style={{
              fontFamily: "var(--font-display)",
              color: "#F0DEB8",
              fontSize: "1.75rem",
              fontWeight: 700,
              letterSpacing: "0.01em",
            }}
          >
            Welcome back, {session.user.name ?? session.user.username}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#6A4E30",
              fontSize: "0.75rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Select a farm to continue
          </p>
          <div className="flex items-center justify-center gap-3 mt-1">
            <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.25)" }} />
            <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "rgba(196,144,48,0.40)" }} />
            <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.25)" }} />
          </div>
        </div>

        {/* Farm cards */}
        {farms.length === 0 ? (
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#7A5840",
              fontSize: "0.9rem",
              background: "#241C14",
              border: "1px solid rgba(196,144,48,0.18)",
              borderRadius: "2rem",
              padding: "1.5rem 2rem",
            }}
          >
            No farms assigned to your account. Contact your administrator.
          </p>
        ) : (
          <div className="flex flex-col gap-3 w-full">
            {isMultiFarm ? (
              // Multi-farm: load overview stats in Suspense so picker renders immediately
              <Suspense fallback={<CardSkeletons farms={farms} />}>
                <OverviewCards userId={userId} farms={farms} />
              </Suspense>
            ) : (
              // Single farm: no Suspense overhead, instant tap
              farms.map((farm, i) => (
                <FarmCard key={farm.slug} farm={farm} index={i} />
              ))
            )}
          </div>
        )}
      </div>

      <footer
        className="absolute bottom-6 text-xs text-center"
        style={{ color: "#3A2A1A", fontFamily: "var(--font-sans)", zIndex: 10 }}
      >
        © {new Date().getFullYear()} FarmTrack
      </footer>
    </div>
  );
}
