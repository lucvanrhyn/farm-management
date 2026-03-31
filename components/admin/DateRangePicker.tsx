"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const PRESETS = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "6m", days: 180 },
  { label: "12m", days: 365 },
];

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface Props {
  defaultDays?: number;
}

export default function DateRangePicker({ defaultDays = 90 }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentFrom = searchParams.get("from") ?? "";
  const currentTo = searchParams.get("to") ?? "";

  const setRange = useCallback(
    (from: string, to: string) => {
      if (from && to && from > to) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("from", from);
      params.set("to", to);
      router.replace(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const applyPreset = useCallback((days: number) => {
    const to = new Date();
    const from = new Date(Date.now() - days * 86_400_000);
    setRange(toYMD(from), toYMD(to));
  }, [setRange]);

  const activeDays = currentFrom && currentTo
    ? Math.round((new Date(currentTo).getTime() - new Date(currentFrom).getTime()) / 86_400_000)
    : defaultDays;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map(({ label, days }) => {
        const isActive = currentFrom !== "" && Math.abs(activeDays - days) < 2;
        return (
          <button
            key={label}
            onClick={() => applyPreset(days)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: isActive ? "rgba(139,105,20,0.15)" : "transparent",
              color: isActive ? "#8B6914" : "#9C8E7A",
              border: `1px solid ${isActive ? "rgba(139,105,20,0.35)" : "#E0D5C8"}`,
            }}
          >
            {label}
          </button>
        );
      })}
      <div className="flex items-center gap-1.5 ml-2">
        <input
          type="date"
          value={currentFrom}
          onChange={(e) =>
            setRange(e.target.value, currentTo || toYMD(new Date()))
          }
          className="text-xs rounded-lg px-2 py-1.5 outline-none"
          style={{ background: "#F5F2EE", color: "#1C1815", border: "1px solid #E0D5C8" }}
        />
        <span className="text-xs" style={{ color: "#9C8E7A" }}>→</span>
        <input
          type="date"
          value={currentTo}
          onChange={(e) =>
            setRange(
              currentFrom || toYMD(new Date(Date.now() - defaultDays * 86_400_000)),
              e.target.value,
            )
          }
          className="text-xs rounded-lg px-2 py-1.5 outline-none"
          style={{ background: "#F5F2EE", color: "#1C1815", border: "1px solid #E0D5C8" }}
        />
      </div>
    </div>
  );
}
