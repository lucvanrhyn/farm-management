export const dynamic = "force-dynamic";
/**
 * Phase L Wave 3E — Farm Methodology Object editor.
 *
 * Paid tiers get the editable form; Basic renders the same form disabled
 * so farmers can see what they'd unlock. All server-side writes are gated
 * at /api/[farmSlug]/farm-settings/methodology, not here — the disabled
 * flag on the form is a UX hint, defence-in-depth lives at the route.
 */

import Link from "next/link";
import { getFarmCreds } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { isPaidTier } from "@/lib/tier";
import type { FarmTier } from "@/lib/tier";
import {
  parseAiSettings,
  type FarmMethodology,
} from "@/lib/einstein/settings-schema";
import MethodologyForm from "@/components/einstein/settings/MethodologyForm";
import { PageHeader } from "@/components/ds";


export default async function MethodologyPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  const tier: FarmTier = (creds?.tier as FarmTier) ?? "basic";
  const canEdit = isPaidTier(tier);

  let methodology: FarmMethodology = {};
  try {
    const prisma = await getPrismaForFarm(farmSlug);
    const row = prisma
      ? await prisma.farmSettings.findFirst({
          select: { aiSettings: true },
        })
      : null;
    const blob = parseAiSettings(row?.aiSettings);
    if (blob.methodology) methodology = blob.methodology;
  } catch {
    // Fail-soft: render an empty form rather than a crash page.
  }

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)] min-h-screen">
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Farm Methodology"
        subtitle="The one-page brief Einstein reads before every answer — tell it how this farm actually runs."
      />

      {!canEdit ? (
        <div
          className="mb-4 rounded-xl p-4 max-w-2xl"
          style={{ background: "var(--ft-fair-bg)", border: "1px solid #F5DEB3" }}
          data-testid="methodology-basic-banner"
        >
          <p className="text-sm" style={{ color: "var(--ft-muted)" }}>
            Farm Methodology is available on Advanced and Consulting plans.
            You can preview the fields below — upgrade to edit.
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
        <MethodologyForm
          farmSlug={farmSlug}
          initial={methodology}
          disabled={!canEdit}
        />
      </div>
    </div>
  );
}
