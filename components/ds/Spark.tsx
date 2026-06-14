import * as React from "react";

/**
 * Tiny inline sparkline. `makeSpark(seed)` gives deterministic demo data when a
 * real series is not yet wired.
 */
export function Spark({
  values,
  w = 80,
  h = 22,
  color = "var(--ft-accent)",
  className,
}: {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
  className?: string;
}) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1 || 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function makeSpark(seed: string, n = 12): number[] {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) % 1000;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483647;
    out.push(40 + (s % 60));
  }
  return out;
}
