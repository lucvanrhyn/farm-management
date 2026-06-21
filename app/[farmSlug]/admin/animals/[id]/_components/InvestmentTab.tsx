// app/[farmSlug]/admin/animals/[id]/_components/InvestmentTab.tsx
// Investment + Cost-of-Gain card duo. Both pulled from financial-analytics.

import nextDynamic from "next/dynamic";
import type { AnimalInvestmentResult } from "@/lib/server/financial-analytics";
import type { ADGResult } from "@/lib/server/weight-analytics";
import CostOfGainCard from "@/components/admin/CostOfGainCard";
import InvestmentTabActions from "./InvestmentTabActions";

const AnimalInvestment = nextDynamic(
  () => import("@/components/admin/AnimalInvestment"),
  { loading: () => <div className="h-48 animate-pulse bg-[var(--ft-surface)] rounded-lg" /> },
);

interface Category {
  id: string;
  name: string;
  type: string;
}

interface InvestmentTabProps {
  investmentData: AnimalInvestmentResult;
  weightData: ADGResult;
  /** Business animal tag — pre-tags transactions added from this tab. */
  animalId: string;
  /** Active species — forwarded to the modal's AnimalPicker scope. */
  species?: string | null;
  incomeCategories: Category[];
  expenseCategories: Category[];
}

export function InvestmentTab({
  investmentData,
  weightData,
  animalId,
  species,
  incomeCategories,
  expenseCategories,
}: InvestmentTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <InvestmentTabActions
          animalId={animalId}
          species={species}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
        />
      </div>
      <AnimalInvestment data={investmentData.totalCost > 0 ? investmentData : null} />
      {investmentData.totalCost > 0 && (
        <CostOfGainCard investment={investmentData} weight={weightData} />
      )}
    </div>
  );
}
