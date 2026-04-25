export const dynamic = "force-dynamic";
/**
 * Phase L Wave 3E — Einstein AI settings page.
 *
 * Three controls live here:
 *   - Rename Einstein (assistantName)
 *   - Response language (auto | en | af)
 *   - Monthly budget cap (ZAR)
 *
 * Paid tiers get the editable form; Basic sees it disabled with an upsell
 * banner. Consulting tenants are budget-exempt so the budget input is
 * hidden entirely — the form renders an "Unlimited" card instead.
 *
 * Server-side tier gating lives on the PUT route; this page's `disabled`
 * prop is a UX hint only (defence-in-depth pattern).
 */

import Link from "next/link";
import { getFarmCreds } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { isPaidTier, isBudgetExempt } from "@/lib/tier";
import type { FarmTier } from "@/lib/tier";
import {
  effectiveAssistantName,
  effectiveResponseLanguage,
  effectiveBudgetCap,
  parseAiSettings,
} from "@/lib/einstein/settings-schema";
import AiSettingsForm from "@/components/einstein/settings/AiSettingsForm";


export default async function AiSettingsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  const tier: FarmTier = (creds?.tier as FarmTier) ?? "basic";
  const canEdit = isPaidTier(tier);
  const budgetExempt = isBudgetExempt(tier);

  // Fail-soft blob read — if the tenant DB is transiently unavailable we
  // still render the form with defaults rather than a crash page.
  let assistantName: string;
  let language: "en" | "af" | "auto";
  let budgetCapZar: number;
  try {
    const prisma = await getPrismaForFarm(farmSlug);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = prisma
      ? await (prisma as any).farmSettings.findFirst({
          select: { aiSettings: true },
        })
      : null;
    const blob = parseAiSettings(row?.aiSettings);
    assistantName = effectiveAssistantName(blob);
    language = effectiveResponseLanguage(blob);
    budgetCapZar = effectiveBudgetCap(blob);
  } catch {
    const blob = parseAiSettings(null);
    assistantName = effectiveAssistantName(blob);
    language = effectiveResponseLanguage(blob);
    budgetCapZar = effectiveBudgetCap(blob);
  }

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8] min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "#1C1815" }}>
          Einstein AI Settings
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          Rename your assistant, pick a reply language, and cap the monthly spend.
        </p>
      </div>

      {!canEdit ? (
        <div
          className="mb-4 rounded-xl p-4 max-w-2xl"
          style={{ background: "#FFFAF0", border: "1px solid #F5DEB3" }}
          data-testid="ai-settings-basic-banner"
        >
          <p className="text-sm" style={{ color: "#6B5E50" }}>
            Einstein is available on Advanced and Consulting plans. You can
            preview the settings below — upgrade to unlock.
          </p>
          <Link
            href={`/${farmSlug}/admin/settings/subscription?upgrade=einstein`}
            className="mt-3 inline-block rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ background: "#8B6914", color: "#F5EBD4" }}
          >
            See plans →
          </Link>
        </div>
      ) : null}

      <div className="max-w-2xl">
        <AiSettingsForm
          farmSlug={farmSlug}
          initialAssistantName={assistantName}
          initialLanguage={language}
          initialBudgetCapZar={budgetCapZar}
          budgetExempt={budgetExempt}
          disabled={!canEdit}
        />
      </div>
    </div>
  );
}
