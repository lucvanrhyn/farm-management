"use client";

import { useState } from "react";
import KampeTab from "@/components/admin/charts/KampeTab";
import DiereTab from "@/components/admin/charts/DiereTab";
import FinansieleTab from "@/components/admin/charts/FinansieleTab";
import type { Camp } from "@/lib/types";
import type {
  ConditionTrendPoint,
  HealthByCamp,
  HeadcountByCamp,
  HeatmapCell,
  MovementRecord,
  CalvingPoint,
  AttritionPoint,
  WithdrawalRecord,
} from "@/lib/server/analytics";

// ── Analytics data passed from the server page ────────────────────────────────

export interface GrafiekeData {
  conditionTrend: ConditionTrendPoint[];
  healthByCamp: HealthByCamp[];
  headcount: HeadcountByCamp[];
  heatmap: HeatmapCell[];
  movements: MovementRecord[];
  calvings: CalvingPoint[];
  attrition: AttritionPoint[];
  withdrawals: WithdrawalRecord[];
}

// ── Financial / herd / camp-cover data ───────────────────────────────────────

export interface FinancialMonthPoint {
  month: string;   // YYYY-MM
  income: number;
  expense: number;
}

export interface HerdCategoryCount {
  category: string;
  count: number;
}

export interface CampCoverRow {
  campId: string;
  campName: string;
  coverCategory: string;
  kgDmPerHa: number;
  recordedAt: string;
  daysGrazingRemaining: number | null;
}

export interface FinansieleData {
  financialTrend: FinancialMonthPoint[];
  herdComposition: HerdCategoryCount[];
  campCover: CampCoverRow[];
}

// ── Tab type ──────────────────────────────────────────────────────────────────

type Tab = "kampe" | "diere" | "finansieel";

const TAB_LABELS: Record<Tab, string> = {
  kampe: "Camps",
  diere: "Animals",
  finansieel: "Financial",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function GrafiekeClient({
  data,
  finansieleData,
  camps,
}: {
  data: GrafiekeData;
  finansieleData: FinansieleData;
  camps: Camp[];
}) {
  const [tab, setTab] = useState<Tab>("kampe");

  return (
    <div>
      {/* Tab switcher */}
      <div className="flex gap-1 mb-8 p-1 rounded-xl w-fit" style={{ background: "rgba(122,92,30,0.08)" }}>
        {(["kampe", "diere", "finansieel"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-5 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              background: tab === t ? "#FFFFFF" : "transparent",
              color: tab === t ? "#1C1815" : "#9C8E7A",
              boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : undefined,
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "kampe" && <KampeTab data={data} camps={camps} />}
      {tab === "diere" && <DiereTab data={data} />}
      {tab === "finansieel" && <FinansieleTab data={finansieleData} />}
    </div>
  );
}
