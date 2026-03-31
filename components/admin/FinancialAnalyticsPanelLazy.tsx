"use client";

import dynamic from "next/dynamic";

const FinancialAnalyticsPanel = dynamic(
  () => import("@/components/admin/FinancialAnalyticsPanel"),
  {
    ssr: false,
    loading: () => (
      <div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />
    ),
  },
);

export default function FinancialAnalyticsPanelLazy({ farmSlug }: { farmSlug: string }) {
  return <FinancialAnalyticsPanel farmSlug={farmSlug} />;
}
