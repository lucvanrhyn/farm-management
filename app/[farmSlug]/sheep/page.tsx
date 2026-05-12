export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCachedFarmSpeciesSettings } from "@/lib/server/cached";

/**
 * `/[farmSlug]/sheep` landing page — issue #227.
 *
 * Per ADR-0003, sheep gets its own namespace at `/sheep/*` (mirror of the
 * cattle admin tree under `/admin/*`). The landing surface itself is a
 * thin router:
 *
 *   - Multi-species tenant (sheep enabled): redirect to `/[slug]/sheep/animals`.
 *     The animals catalogue is the canonical default landing for the species
 *     mirror — the same surface a cattle-mode user lands on at `/[slug]/admin`.
 *
 *   - Cattle-only tenant (sheep NOT enabled — e.g. Basson Boerdery, 103
 *     cattle + 0 sheep): redirect to `/[slug]/admin`. The sheep namespace
 *     is dormant for this tenant; bouncing them to the cattle admin home
 *     beats serving a 404 (it covers an accidental nav from a stale link
 *     or a deep-link in a shared URL) without leaking sheep-shaped chrome
 *     to a cattle-only farmer.
 *
 * Detection uses the cached `getCachedFarmSpeciesSettings` reader — the
 * same source the FarmModeProvider / sub-nav single-species pill (#235)
 * use — so this page is consistent with the rest of the multi-species
 * UX layer. No raw Prisma count from this page.
 */
export default async function SheepLandingPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const { enabledSpecies } = await getCachedFarmSpeciesSettings(farmSlug);

  if (!enabledSpecies.includes("sheep")) {
    redirect(`/${farmSlug}/admin`);
  }

  redirect(`/${farmSlug}/sheep/animals`);
}
