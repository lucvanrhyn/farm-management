import { Lock, Phone, Mail } from "lucide-react";

interface Props {
  feature: string;
  description?: string;
}

export default function UpgradePrompt({ feature, description }: Props) {
  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8] min-h-[60vh] flex items-center justify-center">
      <div
        className="rounded-2xl p-8 max-w-md w-full text-center"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        {/* Lock icon */}
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: "rgba(139,105,20,0.1)", border: "1px solid rgba(139,105,20,0.2)" }}
        >
          <Lock className="w-6 h-6" style={{ color: "#8B6914" }} />
        </div>

        {/* Heading */}
        <h2 className="text-xl font-bold mb-2" style={{ color: "#1C1815" }}>
          {feature}
        </h2>
        <p className="text-sm mb-1 font-medium" style={{ color: "#8B6914" }}>
          Advanced Plan feature
        </p>
        <p className="text-sm mb-6" style={{ color: "#6B5E50" }}>
          {description ??
            "This feature is available on the Advanced plan. Contact us to get a personalised quote and hands-on onboarding."}
        </p>

        {/* CTA buttons */}
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
            style={{ background: "rgba(139,105,20,0.1)", color: "#8B6914", border: "1px solid rgba(139,105,20,0.25)" }}
          >
            <Phone className="w-4 h-4" />
            Call us
          </a>
        </div>

        {/* Tagline */}
        <p className="text-xs mt-5" style={{ color: "#9C8E7A" }}>
          Advanced pricing is based on herd size — we'll quote you directly.
        </p>
      </div>
    </div>
  );
}
