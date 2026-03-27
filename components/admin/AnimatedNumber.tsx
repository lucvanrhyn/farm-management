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
export default function AnimatedNumber({ value, className, style, duration = 700 }: Props) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setDisplay(value); return; }

    let rafId: number;
    let start: number | null = null;

    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      setDisplay(Math.round(ease * value));
      if (progress < 1) rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value, duration]);

  return (
    <span className={className} style={style}>
      {display.toLocaleString()}
    </span>
  );
}
