/**
 * app/[farmSlug]/home/page.tsx — async Server Component (RSC)
 *
 * Issue #438 / PRD #434: previously a Client Component that fetched
 * /api/farm in useEffect, causing a 3-state loading flicker visible in the
 * 2026-05-27 stress-test screen recording:
 *   1. Empty cards
 *   2. Placeholder "FARM MANAGEMENT SYSTEM" + "—" subtitle
 *   3. Branded farm header swap-in
 *
 * Fix: converted to an async RSC that calls getFarmIdentity() server-side.
 * The branded farm data (name, breed, hero image, counts) is in the initial
 * HTML — the HomePortal headline renders it on first paint with no client fetch.
 *
 * Interactive parts (signOut, FarmMode toggle, section navigation, the in-place
 * Einstein AI Advisor overlay) live in HomePageClient (a "use client" component)
 * which renders the dark HomePortal. This matches the standard Next.js App
 * Router RSC → Client Component composition pattern.
 *
 * Per feedback-next16-page-export-contract.md: page files must only export
 * `default` (and optionally the reserved Next.js named exports like
 * `generateMetadata`). No named exports beyond those.
 */

import type { Metadata } from "next";
import { getFarmIdentity } from "@/lib/domain/farm/get-farm-identity";
import HomePageClient from "./HomePageClient";

export const metadata: Metadata = {
  title: "Home — FarmTrack",
};

export default async function HomePage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  // Server-side fetch: branded farm data in the initial HTML so AnimatedHero
  // renders the correct name/breed/image on first paint. No loading state,
  // no client fetch required.
  const farmIdentity = await getFarmIdentity(farmSlug);

  return <HomePageClient farmSlug={farmSlug} initialFarmData={farmIdentity} />;
}
