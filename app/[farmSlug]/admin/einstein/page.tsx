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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = prisma
      ? await (prisma as any).farmSettings.findFirst({
          select: { aiSettings: true },
        })
      : null;
    assistantName = effectiveAssistantName(parseAiSettings(row?.aiSettings));
  } catch {
    assistantName = effectiveAssistantName({});
  }

  return (
    <div className="min-w-0 bg-[#FAFAF8] min-h-screen flex flex-col">
      <header className="px-4 md:px-8 pt-4 md:pt-8 pb-3">
        <h1 className="text-xl font-bold" style={{ color: "#1C1815" }}>
          {assistantName}
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          Ask a question about your farm — every answer cites the records it came from.
        </p>
      </header>

      {/* The chat component styles its own dark bubble — wrap it in a rounded
          card so it sits naturally inside the light-theme admin shell. */}
      <div className="flex-1 min-h-0 px-4 md:px-8 pb-4 md:pb-8">
        <div
          className="h-full rounded-2xl overflow-hidden"
          style={{ border: "1px solid #E0D5C8" }}
        >
          <EinsteinChat farmSlug={farmSlug} className="h-full" />
        </div>
      </div>
    </div>
  );
}
