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
      <div className="flex gap-1 mb-8 p-1 rounded-xl w-fit" style={{ background: "rgba(139,105,20,0.1)" }}>
        {(["kampe", "diere"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-5 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              background: tab === t ? "#241C14" : "transparent",
              color: tab === t ? "#F5EBD4" : "rgba(210,180,140,0.55)",
              boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.3)" : undefined,
            }}
          >
            {t === "kampe" ? "📍 Camps" : "🐄 Animals"}
          </button>
        ))}
      </div>

      {tab === "kampe" ? <KampeTab data={data} /> : <DiereTab data={data} />}
    </div>
  );
}
