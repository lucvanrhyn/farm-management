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
import { PageHeader } from "@/components/ds";


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
    const row = prisma
      ? await prisma.farmSettings.findFirst({
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
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)] min-h-screen">
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Einstein AI Settings"
        subtitle="Rename your assistant, pick a reply language, and cap the monthly spend."
      />

      {!canEdit ? (
        <div
          className="mb-4 rounded-xl p-4 max-w-2xl"
          style={{ background: "var(--ft-fair-bg)", border: "1px solid #F5DEB3" }}
          data-testid="ai-settings-basic-banner"
        >
          <p className="text-sm" style={{ color: "var(--ft-muted)" }}>
            Einstein is available on Advanced and Consulting plans. You can
            preview the settings below — upgrade to unlock.
          </p>
          <Link
            href={`/${farmSlug}/admin/settings/subscription?upgrade=einstein`}
            className="mt-3 inline-block rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ background: "var(--ft-fair)", color: "var(--ft-fair-bg)" }}
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
