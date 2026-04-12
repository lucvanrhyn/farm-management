"use client";

import { useState, useMemo } from "react";
import {
  calcTotalCostPerAnimal,
  calcBreakEvenPrices,
  calcSensitivityTable,
  type BreakEvenInputs,
  type FeedCostMode,
} from "@/lib/calculators/break-even";

const SECTION = "rounded-2xl p-5 mb-4";
const SECTION_STYLE = { backgroundColor: "#fff", border: "1px solid #E8E2D9" };
const LABEL_STYLE = { color: "#6B5E52", fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" as const };
const INPUT_STYLE = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  borderRadius: "0.625rem",
  border: "1px solid #D6CEC4",
  background: "#FAFAF8",
  color: "#1C1815",
  fontSize: "0.875rem",
  outline: "none",
};
const TOGGLE_BASE = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors";

type PriceInputMode = "per_kg" | "per_animal";

interface FormState {
  purchaseMassKg: string;
  priceInputMode: PriceInputMode;
  purchasePricePerKg: string;
  purchasePricePerAnimal: string;
  targetMassKg: string;
  adgKgPerDay: string;
  feedCostMode: FeedCostMode;
  feedCostPerDay: string;
  fcr: string;
  feedPricePerKg: string;
  transportIn: string;
  transportOut: string;
  vetMeds: string;
  mortalityPercent: string;
  fixedOverhead: string;
}

const DEFAULT: FormState = {
  purchaseMassKg: "250",
  priceInputMode: "per_kg",
  purchasePricePerKg: "32",
  purchasePricePerAnimal: "",
  targetMassKg: "420",
  adgKgPerDay: "1.2",
  feedCostMode: "daily_rate",
  feedCostPerDay: "18",
  fcr: "7",
  feedPricePerKg: "4",
  transportIn: "150",
  transportOut: "200",
  vetMeds: "80",
  mortalityPercent: "2",
  fixedOverhead: "0",
};

function num(s: string, fallback = 0): number {
  const n = parseFloat(s);
  return isNaN(n) ? fallback : n;
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-ZA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtR(n: number): string {
  return `R ${fmt(n)}`;
}

export default function BreakEvenCalculator() {
  const [form, setForm] = useState<FormState>(DEFAULT);

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const inputs = useMemo((): BreakEvenInputs | null => {
    const purchaseMass = num(form.purchaseMassKg);
    const targetMass = num(form.targetMassKg);
    const adg = num(form.adgKgPerDay);
    if (purchaseMass <= 0 || targetMass <= purchaseMass || adg <= 0) return null;

    let purchasePricePerKg: number;
    if (form.priceInputMode === "per_animal") {
      const total = num(form.purchasePricePerAnimal);
      purchasePricePerKg = total > 0 && purchaseMass > 0 ? total / purchaseMass : 0;
    } else {
      purchasePricePerKg = num(form.purchasePricePerKg);
    }
    if (purchasePricePerKg <= 0) return null;

    return {
      purchaseMassKg: purchaseMass,
      purchasePricePerKg,
      targetMassKg: targetMass,
      adgKgPerDay: adg,
      feedCostMode: form.feedCostMode,
      feedCostPerDay: num(form.feedCostPerDay),
      fcr: num(form.fcr),
      feedPricePerKg: num(form.feedPricePerKg),
      transportInPerAnimal: num(form.transportIn),
      transportOutPerAnimal: num(form.transportOut),
      vetMedsPerAnimal: num(form.vetMeds),
      mortalityPercent: num(form.mortalityPercent),
      fixedOverheadPerAnimal: num(form.fixedOverhead),
    };
  }, [form]);

  const result = useMemo(() => {
    if (!inputs) return null;
    try {
      const costs = calcTotalCostPerAnimal(inputs);
      const prices = calcBreakEvenPrices(costs.totalCostPerAnimal, inputs.targetMassKg);
      const table = calcSensitivityTable(costs.totalCostPerAnimal, inputs.targetMassKg);
      return { costs, prices, table };
    } catch {
      return null;
    }
  }, [inputs]);

  const marginColors: Record<number, string> = { 0: "#6B5E52", 10: "#2E7D46", 20: "#1A5C8A" };

  return (
    <div className="max-w-3xl">
      {/* ── Purchase ── */}
      <div className={SECTION} style={SECTION_STYLE}>
        <h2 className="text-sm font-bold mb-4" style={{ color: "#1C1815" }}>Purchase Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span style={LABEL_STYLE}>Purchase mass (kg)</span>
            <input style={INPUT_STYLE} type="number" value={form.purchaseMassKg} onChange={(e) => set("purchaseMassKg", e.target.value)} min="0" step="5" />
          </label>
          <label className="flex flex-col gap-1">
            <span style={LABEL_STYLE}>Target sell mass (kg)</span>
            <input style={INPUT_STYLE} type="number" value={form.targetMassKg} onChange={(e) => set("targetMassKg", e.target.value)} min="0" step="5" />
          </label>
          <div className="flex flex-col gap-1 col-span-2">
            <span style={LABEL_STYLE}>Purchase price</span>
            <div className="flex gap-2 mb-2">
              {(["per_kg", "per_animal"] as PriceInputMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => set("priceInputMode", m)}
                  className={TOGGLE_BASE}
                  style={{
                    background: form.priceInputMode === m ? "#1C1815" : "#F0EBE3",
                    color: form.priceInputMode === m ? "#F5F0E8" : "#6B5E52",
                  }}
                >
                  {m === "per_kg" ? "R/kg" : "R/animal"}
                </button>
              ))}
            </div>
            {form.priceInputMode === "per_kg" ? (
              <input style={INPUT_STYLE} type="number" value={form.purchasePricePerKg} onChange={(e) => set("purchasePricePerKg", e.target.value)} min="0" step="0.5" placeholder="R per kg" />
            ) : (
              <input style={INPUT_STYLE} type="number" value={form.purchasePricePerAnimal} onChange={(e) => set("purchasePricePerAnimal", e.target.value)} min="0" step="50" placeholder="R per animal" />
            )}
          </div>
          <label className="flex flex-col gap-1">
            <span style={LABEL_STYLE}>Expected ADG (kg/day)</span>
            <input style={INPUT_STYLE} type="number" value={form.adgKgPerDay} onChange={(e) => set("adgKgPerDay", e.target.value)} min="0.1" step="0.1" />
          </label>
          <label className="flex flex-col gap-1">
            <span style={LABEL_STYLE}>Mortality (%)</span>
            <input style={INPUT_STYLE} type="number" value={form.mortalityPercent} onChange={(e) => set("mortalityPercent", e.target.value)} min="0" max="50" step="0.5" />
          </label>
        </div>
      </div>

      {/* ── Feed cost ── */}
      <div className={SECTION} style={SECTION_STYLE}>
        <h2 className="text-sm font-bold mb-4" style={{ color: "#1C1815" }}>Feed Cost</h2>
        <div className="flex gap-2 mb-4">
          {(["daily_rate", "fcr"] as FeedCostMode[]).map((m) => (
            <button
              key={m}
              onClick={() => set("feedCostMode", m)}
              className={TOGGLE_BASE}
              style={{
                background: form.feedCostMode === m ? "#1C1815" : "#F0EBE3",
                color: form.feedCostMode === m ? "#F5F0E8" : "#6B5E52",
              }}
            >
              {m === "daily_rate" ? "Daily rate" : "FCR"}
            </button>
          ))}
        </div>
        {form.feedCostMode === "daily_rate" ? (
          <label className="flex flex-col gap-1">
            <span style={LABEL_STYLE}>Feed cost per day (R)</span>
            <input style={INPUT_STYLE} type="number" value={form.feedCostPerDay} onChange={(e) => set("feedCostPerDay", e.target.value)} min="0" step="1" />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span style={LABEL_STYLE}>FCR (kg feed / kg gain)</span>
              <input style={INPUT_STYLE} type="number" value={form.fcr} onChange={(e) => set("fcr", e.target.value)} min="1" step="0.5" />
            </label>
            <label className="flex flex-col gap-1">
              <span style={LABEL_STYLE}>Feed price (R/kg)</span>
              <input style={INPUT_STYLE} type="number" value={form.feedPricePerKg} onChange={(e) => set("feedPricePerKg", e.target.value)} min="0" step="0.5" />
            </label>
          </div>
        )}
      </div>

      {/* ── Variable costs ── */}
      <div className={SECTION} style={SECTION_STYLE}>
        <h2 className="text-sm font-bold mb-4" style={{ color: "#1C1815" }}>Other Costs (R/animal)</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span style={LABEL_STYLE}>Transport in</span>
            <input style={INPUT_STYLE} type="number" value={form.transportIn} onChange={(e) => set("transportIn", e.target.value)} min="0" step="10" />
          </label>
          <label className="flex flex-col gap-1">
            <span style={LABEL_STYLE}>Transport out</span>
            <input style={INPUT_STYLE} type="number" value={form.transportOut} onChange={(e) => set("transportOut", e.target.value)} min="0" step="10" />
          </label>
          <label className="flex flex-col gap-1">
            <span style={LABEL_STYLE}>Vet &amp; meds</span>
            <input style={INPUT_STYLE} type="number" value={form.vetMeds} onChange={(e) => set("vetMeds", e.target.value)} min="0" step="10" />
          </label>
          <label className="flex flex-col gap-1">
            <span style={LABEL_STYLE}>Fixed overhead</span>
            <input style={INPUT_STYLE} type="number" value={form.fixedOverhead} onChange={(e) => set("fixedOverhead", e.target.value)} min="0" step="10" />
          </label>
        </div>
      </div>

      {/* ── Results ── */}
      {result && (
        <>
          {/* Cost breakdown */}
          <div className={SECTION} style={{ ...SECTION_STYLE, borderColor: "#C4A882" }}>
            <h2 className="text-sm font-bold mb-4" style={{ color: "#1C1815" }}>Cost Breakdown</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                ["Days on feed", `${Math.round(result.costs.daysOnFeed)} days`],
                ["Mass gain", `${fmt(result.costs.massGainedKg, 1)} kg`],
                ["Purchase cost", fmtR(result.costs.purchaseCostPerAnimal)],
                ["Feed cost", fmtR(result.costs.totalFeedCostPerAnimal)],
                ["Transport", fmtR(result.costs.transportCostPerAnimal)],
                ["Vet & meds", fmtR(result.costs.vetMedsCostPerAnimal)],
                ["Mortality loading", fmtR(result.costs.mortalityLoadingPerAnimal)],
                ["Fixed overhead", fmtR(result.costs.fixedOverheadPerAnimal)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt style={{ color: "#6B5E52" }}>{label}</dt>
                  <dd className="font-medium tabular-nums" style={{ color: "#1C1815" }}>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 pt-4 border-t flex justify-between text-sm font-bold" style={{ borderColor: "#E8E2D9" }}>
              <span style={{ color: "#1C1815" }}>Total cost / animal</span>
              <span style={{ color: "#1C1815" }}>{fmtR(result.costs.totalCostPerAnimal)}</span>
            </div>
            <div className="flex justify-between text-xs mt-1" style={{ color: "#9C8E7A" }}>
              <span>Cost per kg gained</span>
              <span>{fmtR(result.costs.totalCostPerKgGained)}/kg</span>
            </div>
          </div>

          {/* Break-even prices */}
          <div className={SECTION} style={SECTION_STYLE}>
            <h2 className="text-sm font-bold mb-4" style={{ color: "#1C1815" }}>Break-even Sell Price</h2>
            <div className="grid grid-cols-3 gap-3">
              {result.prices.map((p) => (
                <div
                  key={p.margin}
                  className="rounded-xl p-4 text-center"
                  style={{ background: "#F5F0E8" }}
                >
                  <div className="text-xs font-semibold mb-1" style={{ color: marginColors[p.margin] ?? "#6B5E52" }}>
                    {p.margin}% margin
                  </div>
                  <div className="text-lg font-bold tabular-nums" style={{ color: "#1C1815" }}>
                    {fmtR(p.pricePerKg)}/kg
                  </div>
                  <div className="text-xs mt-0.5 tabular-nums" style={{ color: "#9C8E7A" }}>
                    {fmtR(p.pricePerAnimal)}/animal
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sensitivity table */}
          <div className={SECTION} style={SECTION_STYLE}>
            <h2 className="text-sm font-bold mb-1" style={{ color: "#1C1815" }}>Sensitivity Table</h2>
            <p className="text-xs mb-4" style={{ color: "#9C8E7A" }}>Break-even price (R/kg) by sell mass × margin target</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left py-2 pr-3 font-semibold" style={{ color: "#6B5E52" }}>
                      Sell mass (kg)
                    </th>
                    {result.table[0].map((cell) => (
                      <th key={cell.marginPercent} className="py-2 px-2 text-right font-semibold" style={{ color: "#6B5E52" }}>
                        {cell.marginPercent}%
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.table.map((row, i) => {
                    const isBase = Math.abs(row[2].targetMass - (inputs?.targetMassKg ?? 0)) < 0.5;
                    return (
                      <tr
                        key={i}
                        style={{
                          background: isBase ? "#F5F0E8" : "transparent",
                          borderTop: "1px solid #E8E2D9",
                        }}
                      >
                        <td className="py-2 pr-3 font-medium" style={{ color: "#1C1815" }}>
                          {fmt(row[0].targetMass, 0)} kg
                          {isBase && (
                            <span className="ml-1 text-xs" style={{ color: "#9C8E7A" }}>
                              ←
                            </span>
                          )}
                        </td>
                        {row.map((cell) => (
                          <td key={cell.marginPercent} className="py-2 px-2 text-right tabular-nums" style={{ color: "#1C1815" }}>
                            {fmtR(cell.pricePerKg)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!result && inputs === null && (
        <div className="rounded-2xl p-6 text-center text-sm" style={{ background: "#F5F0E8", color: "#9C8E7A" }}>
          Fill in the fields above to see results.
        </div>
      )}
    </div>
  );
}
