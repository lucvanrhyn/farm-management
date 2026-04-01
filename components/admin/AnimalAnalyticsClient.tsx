"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { GrafiekeData } from "@/components/admin/charts/chart-types";

const ChartSkeleton = () => (
  <div className="flex flex-col gap-4">
    {Array.from({ length: 2 }).map((_, i) => (
      <div key={i} className="rounded-xl animate-pulse" style={{ background: "#F5F2EE", height: 200 }} />
    ))}
  </div>
);

const DiereTab = dynamic(() => import("@/components/admin/charts/DiereTab"), {
  ssr: false,
  loading: ChartSkeleton,
});

export default function AnimalAnalyticsClient({
  data,
}: {
  data: GrafiekeData;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-semibold mb-4 px-3 py-2 rounded-lg transition-colors"
        style={{
          color: "#1C1815",
          background: open ? "rgba(139,105,20,0.08)" : "transparent",
          border: "1px solid rgba(139,105,20,0.15)",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transition: "transform 0.2s",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          ▶
        </span>
        Animal Analytics
      </button>
      {open && (
        <div className="mt-2">
          <DiereTab data={data} />
        </div>
      )}
    </div>
  );
}
