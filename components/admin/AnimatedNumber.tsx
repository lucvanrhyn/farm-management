"use client";

import { useEffect, useState } from "react";

interface Props {
  value: number;
  className?: string;
  style?: React.CSSProperties;
  duration?: number;
}

/**
 * Renders an integer that counts up from 0 → value on mount.
 * Falls back to instant render if prefers-reduced-motion is set.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function AnimatedNumber({ value, className, style, duration = 700 }: Props) {
  const reduced = prefersReducedMotion();
  // When reduced-motion is set, render value directly — no animation state needed.
  // When animating, track the in-progress display value via RAF callbacks (async,
  // never from the effect body synchronously).
  const [animatedDisplay, setAnimatedDisplay] = useState(0);

  useEffect(() => {
    if (reduced) return; // reduced-motion branch renders `value` directly

    let rafId: number;
    let start: number | null = null;

    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      setAnimatedDisplay(Math.round(ease * value));
      if (progress < 1) rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value, duration, reduced]);

  const display = reduced ? value : animatedDisplay;

  return (
    <span className={className} style={style}>
      {display.toLocaleString()}
    </span>
  );
}
