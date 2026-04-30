/**
 * app/pricing/page.tsx — Redirect to the marketing pricing page.
 *
 * Audit finding A2: the app's /pricing route was 404ing. This resolves it
 * by permanently redirecting authenticated and anonymous users to the
 * canonical marketing pricing page at farmtrack.app/pricing, which hosts
 * the LSU slider calculator and plan comparison.
 *
 * Why redirect rather than render inline?
 *   - The marketing site owns the LSU pricing calculator (framer-motion,
 *     full FAQ, slider). Duplicating it here would create another divergence
 *     surface — exactly what issue #25 (pricing SSOT) is eliminating.
 *   - Authenticated users who want to subscribe land on /subscribe (which
 *     PayFast-integrates). /pricing is purely informational — the marketing
 *     site is the right home for it.
 *
 * 308 (permanent) is used because the marketing URL is stable. If the
 * marketing URL ever changes, update the constant here and in
 * lib/pricing/compute-total-lsu.ts's SYNC comment.
 */

import { redirect } from 'next/navigation';

const MARKETING_PRICING_URL = 'https://farmtrack.app/pricing';

export default function PricingRedirect() {
  redirect(MARKETING_PRICING_URL);
}
