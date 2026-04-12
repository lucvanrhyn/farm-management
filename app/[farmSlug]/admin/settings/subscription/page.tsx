import { getFarmCreds } from "@/lib/meta-db";
import { Check, X, Mail, Phone } from "lucide-react";
import type { FarmTier } from "@/lib/tier";

export const dynamic = "force-dynamic";

const FEATURES: Array<{ name: string; basic: boolean; advanced: boolean }> = [
  { name: "Animal Logger",           basic: true,  advanced: true },
  { name: "Camp Management",         basic: true,  advanced: true },
  { name: "Map & Satellite",         basic: true,  advanced: true },
  { name: "Import / Export",         basic: true,  advanced: true },
  { name: "Tasks",                   basic: true,  advanced: true },
  { name: "Reports",                 basic: true,  advanced: true },
  { name: "Reproduction Dashboard",  basic: false, advanced: true },
  { name: "Breeding AI",             basic: false, advanced: true },
  { name: "Financial Analytics",     basic: false, advanced: true },
  { name: "Sheep Management",        basic: false, advanced: true },
  { name: "Game Management",         basic: false, advanced: true },
];

function FeatureIcon({ included }: { included: boolean }) {
  return included ? (
    <Check className="w-4 h-4" style={{ color: "#3A6B49" }} />
  ) : (
    <X className="w-4 h-4" style={{ color: "rgba(156,142,122,0.5)" }} />
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
          Your current plan and available features
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Current plan card */}
        <div
          className="rounded-xl p-5"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-lg font-semibold" style={{ color: "#1C1815" }}>
              {isBasic ? "Basic" : "Advanced"} Plan
            </h2>
            <TierBadge tier={tier} />
          </div>
          <p className="text-sm" style={{ color: "#6B5E50" }}>
            {isBasic
              ? "You're on the Basic plan. Upgrade to Advanced for full access to reproduction, breeding AI, financial analytics, and species management."
              : "You have full access to all FarmTrack features."}
          </p>
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
                <th
                  className="text-center px-4 py-2.5 font-semibold w-24"
                  style={{ color: "#9C8E7A" }}
                >
                  Basic
                </th>
                <th
                  className="text-center px-4 py-2.5 font-semibold w-24"
                  style={{ color: "#8B6914" }}
                >
                  Advanced
                </th>
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
                  <td className="text-center px-4 py-2.5">
                    <span className="inline-flex justify-center">
                      <FeatureIcon included={f.basic} />
                    </span>
                  </td>
                  <td className="text-center px-4 py-2.5">
                    <span className="inline-flex justify-center">
                      <FeatureIcon included={f.advanced} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Upgrade CTA (basic only) */}
        {isBasic && (
          <div
            className="rounded-xl p-6 text-center"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <h3 className="text-base font-semibold mb-1" style={{ color: "#1C1815" }}>
              Ready to upgrade?
            </h3>
            <p className="text-sm mb-4" style={{ color: "#6B5E50" }}>
              Contact us for a personalised quote based on your herd size.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href="mailto:vanrhynluc@gmail.com"
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ background: "#8B6914", color: "#FFFBF2" }}
              >
                <Mail className="w-4 h-4" />
                Email us
              </a>
              <a
                href="tel:+27712107201"
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                style={{
                  background: "rgba(139,105,20,0.1)",
                  color: "#8B6914",
                  border: "1px solid rgba(139,105,20,0.25)",
                }}
              >
                <Phone className="w-4 h-4" />
                Call us
              </a>
            </div>
            <p className="text-xs mt-4" style={{ color: "#9C8E7A" }}>
              Advanced pricing is based on herd size — we'll quote you directly.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
