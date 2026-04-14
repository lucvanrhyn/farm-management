import { getFarmCreds } from "@/lib/meta-db";
import { Check, Minus } from "lucide-react";
import type { FarmTier } from "@/lib/tier";
import UpgradePrompt from "@/components/admin/UpgradePrompt";

export const dynamic = "force-dynamic";

type TierKey = "basic" | "advanced" | "consulting";

const FEATURES: Array<{ name: string; tiers: Record<TierKey, boolean> }> = [
  // Daily ops (Basic floor)
  { name: "Logger (cattle / sheep / game)", tiers: { basic: true, advanced: true, consulting: true } },
  { name: "Farm Map + camps",               tiers: { basic: true, advanced: true, consulting: true } },
  { name: "Animals, mobs, photos",          tiers: { basic: true, advanced: true, consulting: true } },
  { name: "Offline PWA",                    tiers: { basic: true, advanced: true, consulting: true } },
  { name: "AI Import Wizard",               tiers: { basic: true, advanced: true, consulting: true } },
  // Intelligence stack (Advanced)
  { name: "Observations trail",             tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Tasks + alerts",                 tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Reports (history, movement, treatments)", tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Reproduction dashboards (cattle + sheep)", tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Breeding AI recommendations",    tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Financial analytics + break-even", tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Veld scoring (DFFE EIM)",        tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Feed on Offer",                  tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Drought / rainfall (SPI)",       tiers: { basic: false, advanced: true, consulting: true } },
  { name: "NVD declarations",               tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Rotation planner",               tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Game census + offtake quotas",   tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Performance + cost-of-gain",     tiers: { basic: false, advanced: true, consulting: true } },
  { name: "SARS IT3 tax export",            tiers: { basic: false, advanced: true, consulting: true } },
  { name: "Weather + compliance exports",   tiers: { basic: false, advanced: true, consulting: true } },
  // White-glove (Consulting)
  { name: "Custom schema fields",           tiers: { basic: false, advanced: false, consulting: true } },
  { name: "Custom analytics / dashboards",  tiers: { basic: false, advanced: false, consulting: true } },
  { name: "Named onboarding lead (90 days)", tiers: { basic: false, advanced: false, consulting: true } },
  { name: "Monthly review call",            tiers: { basic: false, advanced: false, consulting: true } },
  { name: "Priority support SLA",           tiers: { basic: false, advanced: false, consulting: true } },
  { name: "Farm walk + GPS boundary mapping", tiers: { basic: false, advanced: false, consulting: true } },
];

const TIER_META: Record<TierKey, { label: string; tagline: string; color: string; priceLine: string; priceSub: string }> = {
  basic: {
    label: "Basic",
    tagline: "Records your farm.",
    color: "#9C8E7A",
    priceLine: "R1,800 + R0.75 × LSU / yr",
    priceSub: "Monthly option at +20%",
  },
  advanced: {
    label: "Advanced",
    tagline: "Runs your farm.",
    color: "#8B6914",
    priceLine: "R3,000 + R10 × LSU / yr",
    priceSub: "Monthly option at +20%",
  },
  consulting: {
    label: "Consulting",
    tagline: "Builds what you need.",
    color: "#3A6B49",
    priceLine: "R15,000 setup + R1,499/mo",
    priceSub: "12-month minimum retainer",
  },
};

function FeatureCell({ included }: { included: boolean }) {
  return included ? (
    <Check className="w-4 h-4" style={{ color: "#3A6B49" }} />
  ) : (
    <Minus className="w-4 h-4" style={{ color: "rgba(156,142,122,0.4)" }} />
  );
}

function TierBadge({ tier }: { tier: FarmTier }) {
  const isBasic = tier === "basic";
  return (
    <span
      className="inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full"
      style={
        isBasic
          ? { background: "rgba(210,180,140,0.3)", color: "rgba(156,142,122,0.85)" }
          : { background: "rgba(139,105,20,0.2)", color: "#8B6914" }
      }
    >
      {tier}
    </span>
  );
}

export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const creds = await getFarmCreds(farmSlug);
  const tier: FarmTier = (creds?.tier as FarmTier) ?? "advanced";
  const isBasic = tier === "basic";

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8] min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "#1C1815" }}>
          Subscription
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          Plans, pricing, and features
        </p>
      </div>

      <div className="max-w-4xl space-y-6">
        {/* Current plan card */}
        <div
          className="rounded-xl p-5"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-lg font-semibold" style={{ color: "#1C1815" }}>
              Your plan: {isBasic ? "Basic" : "Advanced"}
            </h2>
            <TierBadge tier={tier} />
          </div>
          <p className="text-sm" style={{ color: "#6B5E50" }}>
            {isBasic
              ? "You're on the Basic plan — daily ops essentials. Upgrade to Advanced for the full intelligence stack: reproduction, breeding AI, financial analytics, veld scoring, drought, and more."
              : "You have full access to the Advanced intelligence stack. Contact us about Consulting if you need custom fields or bespoke analytics."}
          </p>
        </div>

        {/* Pricing tiers header cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(Object.keys(TIER_META) as TierKey[]).map((key) => {
            const meta = TIER_META[key];
            return (
              <div
                key={key}
                className="rounded-xl p-4"
                style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
              >
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className="text-base font-semibold" style={{ color: meta.color }}>
                    {meta.label}
                  </h3>
                </div>
                <p className="text-xs italic mb-3" style={{ color: "#6B5E50" }}>
                  {meta.tagline}
                </p>
                <p className="text-sm font-semibold font-mono" style={{ color: "#1C1815" }}>
                  {meta.priceLine}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
                  {meta.priceSub}
                </p>
              </div>
            );
          })}
        </div>

        {/* Feature comparison table */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid #E0D5C8" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#F5F0EA" }}>
                <th
                  className="text-left px-4 py-2.5 font-semibold"
                  style={{ color: "#1C1815" }}
                >
                  Feature
                </th>
                {(Object.keys(TIER_META) as TierKey[]).map((key) => (
                  <th
                    key={key}
                    className="text-center px-4 py-2.5 font-semibold w-28"
                    style={{ color: TIER_META[key].color }}
                  >
                    {TIER_META[key].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f, i) => (
                <tr
                  key={f.name}
                  style={{
                    background: i % 2 === 0 ? "#FFFFFF" : "#FAFAF8",
                    borderTop: "1px solid #F0EBE3",
                  }}
                >
                  <td className="px-4 py-2.5" style={{ color: "#1C1815" }}>
                    {f.name}
                  </td>
                  {(Object.keys(TIER_META) as TierKey[]).map((key) => (
                    <td key={key} className="text-center px-4 py-2.5">
                      <span className="inline-flex justify-center">
                        <FeatureCell included={f.tiers[key]} />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* LSU pricing explainer */}
        <div
          className="rounded-xl p-5"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <h3 className="text-sm font-semibold mb-2" style={{ color: "#1C1815" }}>
            How LSU pricing works
          </h3>
          <p className="text-sm mb-2" style={{ color: "#6B5E50" }}>
            Pricing is based on Large Stock Units (LSU) — a species-weighted headcount.
            Cattle count 1.0, sheep and goats 0.15, horses 1.2, impala 0.15, kudu 0.4,
            wildebeest 0.6, eland 0.9, giraffe 1.5, zebra 0.7.
          </p>
          <p className="text-sm" style={{ color: "#6B5E50" }}>
            Your LSU is locked at sign-up and recomputed at renewal. Mid-term growth is
            free. Consulting is a flat retainer regardless of herd size.
          </p>
        </div>

        {/* Upgrade CTA (basic only) */}
        {isBasic && (
          <UpgradePrompt
            feature="the full intelligence stack"
            description="Observations, reports, breeding AI, financial analytics, veld scoring, rotation planner, and more — all in one plan."
            farmSlug={farmSlug}
          />
        )}
      </div>
    </div>
  );
}
