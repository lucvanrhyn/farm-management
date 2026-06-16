export const dynamic = "force-dynamic";
/**
 * Phase L Wave 3E — Farm Einstein chat page.
 *
 * Thin server shell:
 *   - Gates the route at Basic tier (Basic → redirect to subscription page
 *     with the Einstein upsell query param).
 *   - Reads `aiSettings.assistantName` from the tenant DB so the header
 *     wordmark SSRs with the correct name (no flash from "Einstein" → custom).
 *   - Mounts <EinsteinChat> which handles streaming, citations, feedback.
 *
 * Layout above already enforces ADMIN + the AssistantNameProvider is mounted
 * around the whole admin subtree, so the client chat component can read the
 * name via useAssistantName() too — we duplicate the SSR fetch here only for
 * the page header chrome (renders before the provider hydrates).
 */

import { redirect } from "next/navigation";
import { getFarmCreds } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { isPaidTier } from "@/lib/tier";
import type { FarmTier } from "@/lib/tier";
import {
  effectiveAssistantName,
  parseAiSettings,
} from "@/lib/einstein/settings-schema";
import {
  EinsteinAdvisorPanel,
  type AdvisorBriefItem,
  type AdvisorAction,
} from "@/components/einstein/EinsteinChat";


/**
 * Default desktop advisor brief. The page is a thin shell with no notifications
 * source in scope, so we seed a sensible 3-item briefing (entities bold). When
 * a real brief/notifications feed is wired into this route, swap these for the
 * derived items — the panel contract is data-driven.
 */
const DEFAULT_BRIEF: readonly AdvisorBriefItem[] = [
  {
    text: "Camp H mob is low on water — the Walhalla trough is empty. Move them today.",
    bold: ["Camp H", "Walhalla"],
  },
  {
    text: "VR-014 is running below target ADG in B1 — pull to the kraal for feeding.",
    bold: ["VR-014"],
  },
  {
    text: "KO-404 clears withdrawal Saturday and is sale-ready for the next auction.",
    bold: ["KO-404"],
  },
];

/** Default desktop action buttons — each seeds the chat with a preset prompt. */
const DEFAULT_ACTIONS: readonly AdvisorAction[] = [
  { label: "Plan Camp H move", prompt: "Plan the Camp H mob move for today." },
  {
    label: "Show low-ADG animals",
    prompt: "Show me the animals with the lowest average daily gain.",
  },
  {
    label: "Weekly grazing forecast",
    prompt: "Give me the weekly grazing forecast across all camps.",
  },
];

export default async function EinsteinPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  const tier: FarmTier = (creds?.tier as FarmTier) ?? "basic";

  if (!isPaidTier(tier)) {
    redirect(`/${farmSlug}/admin/settings/subscription?upgrade=einstein`);
  }

  // SSR the assistant name from the tenant blob so the header wordmark doesn't
  // flicker. `prisma` may be null on transient DB failures — fall back to the
  // default name in that case.
  let assistantName: string;
  try {
    const prisma = await getPrismaForFarm(farmSlug);
    const row = prisma
      ? await prisma.farmSettings.findFirst({
          select: { aiSettings: true },
        })
      : null;
    assistantName = effectiveAssistantName(parseAiSettings(row?.aiSettings));
  } catch {
    assistantName = effectiveAssistantName({});
  }

  return (
    <div
      className="ft-scope flex min-h-screen min-w-0 flex-col"
      style={{ background: "var(--ft-bg)", color: "var(--ft-text)" }}
    >
      {/* Desktop advisor composition — serif H1 + model pill, always-on brief
          card, action-button row and the real <EinsteinChat>. The assistant
          name routes through the SSR fetch above; "AI Advisor" is the surface
          label, never a hardcoded assistant name. The brief/actions seed the
          chat's existing send path (no chat logic forked). */}
      <div className="min-h-0 flex-1 px-4 py-4 md:px-8 md:py-8">
        <EinsteinAdvisorPanel
          farmSlug={farmSlug}
          assistantName={assistantName}
          briefItems={DEFAULT_BRIEF}
          actions={DEFAULT_ACTIONS}
        />
      </div>
    </div>
  );
}
