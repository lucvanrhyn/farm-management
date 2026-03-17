"use client";

import { useState } from "react";
import KampeTab from "@/components/admin/charts/KampeTab";
import DiereTab from "@/components/admin/charts/DiereTab";
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

type Tab = "kampe" | "diere";

export default function GrafiekeClient({ data }: { data: GrafiekeData }) {
  const [tab, setTab] = useState<Tab>("kampe");

  return (
    <div>
      {/* Tab switcher */}
      <div className="flex gap-2 mb-8 border-b border-stone-200">
        {(["kampe", "diere"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium capitalize rounded-t-lg transition-colors ${
              tab === t
                ? "bg-white border border-b-white border-stone-200 text-stone-800 -mb-px"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {t === "kampe" ? "📍 Camps" : "🐄 Animals"}
          </button>
        ))}
      </div>

      {tab === "kampe" ? <KampeTab data={data} /> : <DiereTab data={data} />}
    </div>
  );
}
