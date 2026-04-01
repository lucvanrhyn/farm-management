/**
 * Shared chart data types used by KampeTab, DiereTab, and FinansieleTab.
 * Decoupled from GrafiekeClient so these tabs can be embedded anywhere.
 */

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
import type { HerdAdgPoint } from "@/lib/server/weight-analytics";
import type {
  FinancialMonthPoint,
  HerdCategoryCount,
  CampCoverRow,
  FinansieleData,
} from "@/lib/server/chart-data";

export type {
  FinancialMonthPoint,
  HerdCategoryCount,
  CampCoverRow,
  FinansieleData,
};

export interface GrafiekeData {
  conditionTrend: ConditionTrendPoint[];
  healthByCamp: HealthByCamp[];
  headcount: HeadcountByCamp[];
  heatmap: HeatmapCell[];
  movements: MovementRecord[];
  calvings: CalvingPoint[];
  attrition: AttritionPoint[];
  withdrawals: WithdrawalRecord[];
  herdAdgTrend: HerdAdgPoint[];
}
