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

export const dynamic = "force-dynamic";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = prisma
      ? await (prisma as any).farmSettings.findFirst({
          select: { aiSettings: true },
        })
      : null;
    const blob = parseAiSettings(row?.aiSettings);
    if (blob.methodology) methodology = blob.methodology;
  } catch {
    // Fail-soft: render an empty form rather than a crash page.
  }

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8] min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "#1C1815" }}>
          Farm Methodology
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          The one-page brief Einstein reads before every answer — tell it how this farm actually runs.
        </p>
      </div>

      {!canEdit ? (
        <div
          className="mb-4 rounded-xl p-4 max-w-2xl"
          style={{ background: "#FFFAF0", border: "1px solid #F5DEB3" }}
          data-testid="methodology-basic-banner"
        >
          <p className="text-sm" style={{ color: "#6B5E50" }}>
            Farm Methodology is available on Advanced and Consulting plans.
            You can preview the fields below — upgrade to edit.
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
        <MethodologyForm
          farmSlug={farmSlug}
          initial={methodology}
          disabled={!canEdit}
        />
      </div>
    </div>
  );
}
