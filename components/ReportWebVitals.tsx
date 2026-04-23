"use client";

import { useReportWebVitals } from "next/web-vitals";
import { usePathname } from "next/navigation";

// Core Web Vitals (LCP/CLS/INP) + supporting navigation timings (FCP/TTFB).
// Sent best-effort via sendBeacon when the page unloads, else fetch keepalive.
// Server-side writes land in meta-DB VitalsEvent table; see
// scripts/migrate-meta-vitals-events.ts for the schema.

type VitalPayload = {
  id: string;
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  delta: number;
  navigationType: string;
  route: string;
};

function send(payload: VitalPayload) {
  const body = JSON.stringify(payload);
  const url = "/api/telemetry/vitals";
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    } catch {
      // fall through to fetch
    }
  }
  try {
    void fetch(url, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
    });
  } catch {
    // swallow — telemetry must never break the page
  }
}

export function ReportWebVitals() {
  const pathname = usePathname();
  useReportWebVitals((metric) => {
    send({
      id: metric.id,
      name: metric.name,
      value: metric.value,
      rating: metric.rating as VitalPayload["rating"],
      delta: metric.delta,
      navigationType: metric.navigationType,
      route: pathname ?? "",
    });
  });
  return null;
}
