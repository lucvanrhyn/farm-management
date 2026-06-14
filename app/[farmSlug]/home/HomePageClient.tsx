"use client";

/**
 * app/[farmSlug]/home/HomePageClient.tsx — Client Component
 *
 * The dark "Operations hub" landing portal. Renders the HomePortal presentation
 * shell (4 destination tiles + Einstein brief) and owns the interactive wiring:
 *   - signOut (next-auth/react)
 *   - useFarmMode hook (active species + multi-species mode toggle)
 *   - section navigation (useRouter)
 *   - Einstein AI Advisor opens an IN-PLACE chat overlay (no navigation),
 *     wrapping the real streaming <EinsteinChat farmSlug/> in EinsteinOverlay
 *   - owner display name from the next-auth session
 *
 * Receives `initialFarmData` (FarmIdentity: farmName / breed / heroImageUrl /
 * animalCount / campCount) from the RSC parent (page.tsx) which calls
 * getFarmIdentity() server-side. The branded farm name is in the initial HTML —
 * no useEffect fetch, no placeholder states (Issue #438 / PRD #434 guard).
 *
 * Surface mode: the root wraps in "dark-surface ft-scope" so the dark token set
 * + selection/focus styling apply (Home is a dark surface).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useFarmMode, type FarmMode } from "@/lib/farm-mode";
import type { FarmIdentity } from "@/lib/domain/farm/get-farm-identity";
import { HomePortal } from "@/components/home/HomePortal";
import { EinsteinOverlay } from "@/components/home/EinsteinOverlay";

// Section sub-labels adapt per farm mode (species view).
const MODE_SECTIONS: Record<FarmMode, { admin: string; logger: string; map: string }> = {
  cattle: { admin: "Herd, camps & data", logger: "Camp rounds", map: "Farm map" },
  sheep: { admin: "Flock, camps & data", logger: "Flock rounds", map: "Farm map" },
  game: { admin: "Census, hunting & data", logger: "Ecological monitoring", map: "Farm map" },
};

export default function HomePageClient({
  farmSlug,
  initialFarmData,
}: {
  farmSlug: string;
  initialFarmData: FarmIdentity;
}) {
  const router = useRouter();
  const { mode, setMode, isMultiMode } = useFarmMode();
  const { data: session } = useSession();
  const [chatOpen, setChatOpen] = useState(false);

  const sections = MODE_SECTIONS[mode];

  // Owner display name from the authenticated session (name → username → email).
  const owner =
    session?.user?.name ??
    session?.user?.username ??
    session?.user?.email ??
    "";

  // The hero image URL is still server-provided (no client fetch). It backs the
  // root so the dark portal layers its warm radial glow over the branded photo.
  const heroImageUrl = initialFarmData.heroImageUrl;

  return (
    <div
      className="dark-surface ft-scope"
      style={{
        position: "relative",
        minHeight: "100vh",
        backgroundImage: heroImageUrl ? `url("${heroImageUrl}")` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <HomePortal
        farmName={initialFarmData.farmName}
        breed={initialFarmData.breed}
        owner={owner}
        animalCount={initialFarmData.animalCount}
        campCount={initialFarmData.campCount}
        sections={sections}
        mode={mode}
        isMultiMode={isMultiMode}
        onSetMode={setMode}
        onNavigate={(path) => router.push(`/${farmSlug}${path}`)}
        onAskEinstein={() => setChatOpen(true)}
        onSignOut={() => signOut({ callbackUrl: "/login" })}
      />

      <EinsteinOverlay
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        farmSlug={farmSlug}
      />
    </div>
  );
}
