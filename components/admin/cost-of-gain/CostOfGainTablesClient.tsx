"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type {
  CogByCampRow,
  CogByAnimalRow,
} from "@/lib/server/financial-analytics";
import type { CogScope } from "@/lib/calculators/cost-of-gain";

type View = "camp" | "animal";

function fmtR(n: number): string {
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

function fmtCog(n: number | null): string {
  return n === null ? "—" : `R ${n.toFixed(2)}/kg`;
}

function fmtKg(n: number): string {
  return `${Math.round(n).toLocaleString("en-ZA")} kg`;
}

function deltaBadge(value: number | null, baseline: number | null) {
  if (value === null || baseline === null || baseline === 0) {
    return <span style={{ color: "#9C8E7A" }}>—</span>;
  }
  const delta = ((value - baseline) / baseline) * 100;
  const color = delta < 0 ? "#4A7C59" : delta > 10 ? "#C0574C" : "#C98A2B";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className="font-mono text-xs" style={{ color }}>
      {sign}
      {delta.toFixed(0)}%
    </span>
  );
}

export default function CostOfGainTablesClient({
  byCamp,
  byAnimal,
  scope,
  farmCostOfGain,
}: {
  byCamp: CogByCampRow[];
  byAnimal: CogByAnimalRow[];
  scope: CogScope;
  farmCostOfGain: number | null;
}) {
  const [view, setView] = useState<View>("camp");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setScope(next: CogScope) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("cogScope");
    else params.set("cogScope", next);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const tabStyle = (active: boolean) => ({
    padding: "6px 12px",
    borderRadius: "6px",
    border: active ? "1px solid #8B6914" : "1px solid #E0D5C8",
    background: active ? "rgba(139,105,20,0.08)" : "#FFFFFF",
    color: active ? "#8B6914" : "#1C1815",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          <button
            type="button"
            style={tabStyle(view === "camp")}
            onClick={() => setView("camp")}
          >
            By Camp
          </button>
          <button
            type="button"
            style={tabStyle(view === "animal")}
            onClick={() => setView("animal")}
          >
            By Animal
          </button>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-xs" style={{ color: "#9C8E7A" }}>
            Scope:
          </span>
          <button
            type="button"
            style={tabStyle(scope === "all")}
            onClick={() => setScope("all")}
            disabled={pending}
          >
            All expenses
          </button>
          <button
            type="button"
            style={tabStyle(scope === "feed_vet")}
            onClick={() => setScope("feed_vet")}
            disabled={pending}
          >
            Feed + Vet only
          </button>
        </div>
      </div>

      {view === "camp" ? (
        byCamp.length === 0 ? (
          <p className="text-sm" style={{ color: "#9C8E7A" }}>
            No camps with recorded costs or weight gain in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  style={{
                    color: "#9C8E7A",
                    borderBottom: "1px solid #E0D5C8",
                  }}
                >
                  <th className="text-left py-2 pr-3 font-medium">Camp</th>
                  <th className="text-right py-2 px-3 font-medium">Ha</th>
                  <th className="text-right py-2 px-3 font-medium">Animals</th>
                  <th className="text-right py-2 px-3 font-medium">Cost</th>
                  <th className="text-right py-2 px-3 font-medium">Gain</th>
                  <th className="text-right py-2 px-3 font-medium">COG</th>
                  <th className="text-right py-2 px-3 font-medium">vs farm</th>
                </tr>
              </thead>
              <tbody>
                {byCamp.map((row) => (
                  <tr
                    key={row.campId}
                    style={{ borderBottom: "1px solid #F0EAE1" }}
                  >
                    <td className="py-2 pr-3" style={{ color: "#1C1815" }}>
                      {row.campName}
                    </td>
                    <td
                      className="py-2 px-3 text-right font-mono"
                      style={{ color: "#1C1815" }}
                    >
                      {row.hectares !== null ? row.hectares.toFixed(1) : "—"}
                    </td>
                    <td
                      className="py-2 px-3 text-right font-mono"
                      style={{ color: "#1C1815" }}
                    >
                      {row.activeAnimalCount}
                    </td>
                    <td
                      className="py-2 px-3 text-right font-mono"
                      style={{ color: "#1C1815" }}
                    >
                      {fmtR(row.totalCost)}
                    </td>
                    <td
                      className="py-2 px-3 text-right font-mono"
                      style={{ color: "#1C1815" }}
                    >
                      {row.kgGained > 0 ? fmtKg(row.kgGained) : "—"}
                    </td>
                    <td
                      className="py-2 px-3 text-right font-mono font-bold"
                      style={{ color: "#8B6914" }}
                    >
                      {fmtCog(row.costOfGain)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {deltaBadge(row.costOfGain, farmCostOfGain)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : byAnimal.length === 0 ? (
        <p className="text-sm" style={{ color: "#9C8E7A" }}>
          No animals with both direct costs and weight gain in this period.
          Expenses logged at camp level (most feed bills) won&apos;t appear here
          — use the By Camp view.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                style={{
                  color: "#9C8E7A",
                  borderBottom: "1px solid #E0D5C8",
                }}
              >
                <th className="text-left py-2 pr-3 font-medium">Tag</th>
                <th className="text-left py-2 px-3 font-medium">Category</th>
                <th className="text-left py-2 px-3 font-medium">Camp</th>
                <th className="text-right py-2 px-3 font-medium">Cost</th>
                <th className="text-right py-2 px-3 font-medium">Gain</th>
                <th className="text-right py-2 px-3 font-medium">COG</th>
              </tr>
            </thead>
            <tbody>
              {byAnimal.map((row) => (
                <tr
                  key={row.animalId}
                  style={{ borderBottom: "1px solid #F0EAE1" }}
                >
                  <td className="py-2 pr-3" style={{ color: "#1C1815" }}>
                    {row.animalId}
                    {row.name ? (
                      <span
                        className="ml-1 text-xs"
                        style={{ color: "#9C8E7A" }}
                      >
                        {row.name}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 px-3" style={{ color: "#1C1815" }}>
                    {row.category}
                  </td>
                  <td className="py-2 px-3" style={{ color: "#1C1815" }}>
                    {row.currentCamp}
                  </td>
                  <td
                    className="py-2 px-3 text-right font-mono"
                    style={{ color: "#1C1815" }}
                  >
                    {fmtR(row.totalCost)}
                  </td>
                  <td
                    className="py-2 px-3 text-right font-mono"
                    style={{ color: "#1C1815" }}
                  >
                    {row.kgGained > 0 ? fmtKg(row.kgGained) : "—"}
                  </td>
                  <td
                    className="py-2 px-3 text-right font-mono font-bold"
                    style={{ color: "#8B6914" }}
                  >
                    {fmtCog(row.costOfGain)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
