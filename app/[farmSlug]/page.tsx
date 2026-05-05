/**
 * Tenant root — `/[farmSlug]`.
 *
 * Visual audit P0 (2026-05-04): without this file Next.js renders the
 * global 404 page when a customer visits `/<their-slug>` (no sub-path).
 * That happens whenever someone bookmarks the bare farm URL or types it
 * by memory — a broken first impression on the most-visited path the
 * tenant has.
 *
 * The redirect target is `/<slug>/admin` because that layout already
 * implements the canonical landing logic:
 *
 *   • unauthenticated   → `/login`
 *   • non-ADMIN role    → `/<slug>/home`
 *   • fresh tenant      → `/<slug>/onboarding`
 *   • otherwise         → renders the admin page
 *
 * Sending tenant-root traffic through `/admin` re-uses that single
 * source of truth instead of forking the auth/role/onboarding logic
 * here.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FarmSlugRootPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  redirect(`/${farmSlug}/admin`);
}
