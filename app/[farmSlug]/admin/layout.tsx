import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AdminNav from "@/components/admin/AdminNav";
import { TierProvider } from "@/components/tier-provider";
import { AssistantNameProvider } from "@/hooks/useAssistantName";
import { getFarmCreds } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getSession } from "@/lib/auth";
import { getUserRoleForFarm } from "@/lib/auth";
import type { FarmTier } from "@/lib/tier";
import {
  effectiveAssistantName,
  parseAiSettings,
} from "@/lib/einstein/settings-schema";

/**
 * Path suffixes that must render normally while onboardingComplete is still false.
 * Admins need to be able to upgrade mid-wizard (e.g. hit the paywall, pay,
 * and come back) without being bounced back to the onboarding shell.
 *
 * Suffixes include their leading `/` and trailing segment — they are matched
 * exactly (plus an optional trailing `/`) after the pathname is normalised,
 * so `/admin/settings/subscription/../animals` cannot slip through.
 */
const ONBOARDING_WHITELIST_SUFFIXES = ["/admin/settings/subscription"] as const;

/**
 * Normalise a URL pathname enough to safely match it against a fixed
 * whitelist. Strips any query/hash, collapses duplicate slashes, and
 * resolves `..` / `.` segments the way a URL parser would. The resulting
 * value is relative (no scheme/host), starts with `/`, and contains no
 * traversal tokens.
 */
function normalisePathname(raw: string): string | null {
  try {
    // Strip query/hash and reject absolute/external URLs. URL parser
    // needs a base, and setting one anchors the path so traversal is
    // resolved against it rather than leaking outside.
    const url = new URL(raw, "https://_local");
    if (url.origin !== "https://_local") return null;
    return url.pathname.replace(/\/+$/g, ""); // trim trailing slashes
  } catch {
    return null;
  }
}

function shouldBypassOnboardingGate(rawPathname: string | null): boolean {
  if (!rawPathname) return false;
  const normalised = normalisePathname(rawPathname);
  if (!normalised) return false;
  return ONBOARDING_WHITELIST_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}

async function currentPathname(): Promise<string | null> {
  // Next.js sets `next-url` on RSC navigations and `x-invoke-path` on
  // certain runtime paths. We fall back gracefully on the initial full
  // page load and treat "unknown" as "not whitelisted" — which means a
  // fresh farm always gets bounced to /onboarding on first paint, and
  // client-side navigations to /admin/settings/subscription correctly
  // bypass the gate.
  const h = await headers();
  return (
    h.get("next-url") ??
    h.get("x-invoke-path") ??
    h.get("x-pathname") ??
    null
  );
}

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  // Guard: require authenticated ADMIN role for this specific farm
  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (getUserRoleForFarm(session, farmSlug) !== "ADMIN") {
    redirect(`/${farmSlug}/home`);
  }

  let tier: FarmTier = "basic"; // fail-safe: minimum privilege on error
  let enabledSpecies: string[] | undefined;
  let onboardingComplete = true; // fail-open: if settings fetch fails, do NOT bounce
  let assistantName: string | null = null; // null → provider falls back to "Einstein"

  const [credsResult, prismaResult] = await Promise.allSettled([
    getFarmCreds(farmSlug),
    getPrismaForFarm(farmSlug),
  ]);

  if (credsResult.status === "rejected") {
    console.error(`[AdminLayout] getFarmCreds failed for "${farmSlug}":`, credsResult.reason);
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <div className="text-center max-w-md px-4">
          <h1 className="text-lg font-bold mb-2" style={{ color: "#1C1815" }}>
            Connection Error
          </h1>
          <p className="text-sm" style={{ color: "#9C8E7A" }}>
            Could not connect to the database. Please try refreshing the page or contact support if the issue persists.
          </p>
        </div>
      </div>
    );
  }

  tier = (credsResult.value?.tier ?? "basic") as FarmTier;

  const prisma = prismaResult.status === "fulfilled" ? prismaResult.value : null;
  if (prisma) {
    // Resolve settings + species separately so a DB error on one does not
    // corrupt the other. We also distinguish "settings threw" (fail-open —
    // keep onboardingComplete=true) from "settings is null" (brand-new
    // tenant — bounce to wizard).
    const [speciesRes, settingsRes] = await Promise.allSettled([
      prisma.farmSpeciesSettings.findMany(),
      // Also read aiSettings so we can hydrate the AssistantNameProvider below
      // — one round trip covers both onboardingComplete and the blob.
      prisma.farmSettings.findFirst({
        select: { onboardingComplete: true, aiSettings: true },
      }),
    ]);

    if (speciesRes.status === "fulfilled") {
      enabledSpecies = speciesRes.value.filter((r) => r.enabled).map((r) => r.species);
    }

    if (settingsRes.status === "fulfilled") {
      // A brand-new tenant with no FarmSettings row is treated as "onboarding
      // not complete" — guide the admin through the wizard on first visit.
      const row = settingsRes.value;
      onboardingComplete = row?.onboardingComplete ?? false;
      // Parse is fail-soft — malformed JSON collapses to empty + default name.
      const aiBlob = parseAiSettings(row?.aiSettings);
      const resolved = effectiveAssistantName(aiBlob);
      // effectiveAssistantName returns the default when unset — passing the
      // default through the provider is fine (it normalises again).
      assistantName = resolved;
    } else {
      console.error(
        `[AdminLayout] farmSettings.findFirst failed for "${farmSlug}":`,
        settingsRes.reason,
      );
      // fail-open: a transient DB error must NOT trap an established admin
      // in /onboarding. Leave onboardingComplete=true so the page renders.
      // assistantName stays null → provider normalises to "Einstein".
    }
  }
  // fail-open: if prisma unavailable, enabledSpecies stays undefined → AdminNav shows all,
  // and onboardingComplete stays `true` so we don't bounce on a DB blip.

  // Onboarding gate: fresh farms are redirected to the wizard, except for
  // the subscription page (so admins can upgrade mid-flow).
  if (!onboardingComplete) {
    const pathname = await currentPathname();
    if (!shouldBypassOnboardingGate(pathname)) {
      redirect(`/${farmSlug}/onboarding`);
    }
  }

  return (
    <AssistantNameProvider name={assistantName}>
      <TierProvider tier={tier}>
        <div className="flex min-h-screen">
          <AdminNav tier={tier} enabledSpecies={enabledSpecies} />
          <main className="flex-1">{children}</main>
        </div>
      </TierProvider>
    </AssistantNameProvider>
  );
}
