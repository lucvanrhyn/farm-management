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
import { EinsteinChat } from "@/components/einstein/EinsteinChat";
import { PageHeader } from "@/components/ds";


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
      {/* Light "Operations" shell header — Fraunces title + mono subtitle.
          assistantName routes through useAssistantName() / the SSR fetch above;
          "AI Advisor" is the surface label, never a hardcoded assistant name. */}
      <PageHeader
        className="px-4 pt-4 md:px-8 md:pt-8"
        title="AI Advisor"
        subtitle={`${assistantName} · every answer cites the records it came from`}
      />

      {/* The chat component styles its own dark panel — wrap it in a token
          surface card so the dark-on-light intent reads as a deliberate inset
          inside the light admin shell. */}
      <div className="min-h-0 flex-1 px-4 pb-4 md:px-8 md:pb-8">
        <div className="ft-card h-full overflow-hidden">
          <EinsteinChat farmSlug={farmSlug} className="h-full" />
        </div>
      </div>
    </div>
  );
}
