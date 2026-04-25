// app/[farmSlug]/admin/animals/[id]/_components/InvestmentTab.tsx
// Investment + Cost-of-Gain card duo. Both pulled from financial-analytics.

import nextDynamic from "next/dynamic";
import type { AnimalInvestmentResult } from "@/lib/server/financial-analytics";
import type { ADGResult } from "@/lib/server/weight-analytics";
import CostOfGainCard from "@/components/admin/CostOfGainCard";

const AnimalInvestment = nextDynamic(
  () => import("@/components/admin/AnimalInvestment"),
  { loading: () => <div className="h-48 animate-pulse bg-gray-100 rounded-lg" /> },
);

interface InvestmentTabProps {
  investmentData: AnimalInvestmentResult;
  weightData: ADGResult;
}

export function InvestmentTab({ investmentData, weightData }: InvestmentTabProps) {
  return (
    <div className="space-y-4">
      <AnimalInvestment data={investmentData.totalCost > 0 ? investmentData : null} />
      {investmentData.totalCost > 0 && (
        <CostOfGainCard investment={investmentData} weight={weightData} />
      )}
    </div>
  );
}
