// components/admin/observations-log/Filters.tsx
// Camp + observation type selectors above the timeline.

"use client";

import type { Camp, ObservationType } from "@/lib/types";
import { OBS_TYPES, lightSelect } from "./constants";

interface FiltersProps {
  camps: Camp[];
  campFilter: string;
  typeFilter: ObservationType | "all";
  loading: boolean;
  onChange: (camp: string, type: ObservationType | "all") => void;
}

export function Filters({ camps, campFilter, typeFilter, loading, onChange }: FiltersProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <select
        value={campFilter}
        onChange={(e) => onChange(e.target.value, typeFilter)}
        style={lightSelect}
      >
        <option value="all">All Camps</option>
        {camps.map((c) => <option key={c.camp_id} value={c.camp_id}>{c.camp_name}</option>)}
      </select>

      <select
        value={typeFilter}
        onChange={(e) => onChange(campFilter, e.target.value as ObservationType | "all")}
        style={lightSelect}
      >
        {OBS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      {loading && <span className="self-center text-xs" style={{ color: "#9C8E7A" }}>Loading...</span>}
    </div>
  );
}
