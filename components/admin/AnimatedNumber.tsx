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
 *
 * Hydration safety (issue #259):
 *   - The initial render is ALWAYS "0" — independent of `window`,
 *     `matchMedia`, or `value`. This guarantees the SSR HTML matches the
 *     client's first render. The pre-fix component called
 *     `window.matchMedia` during render, so SSR (no `window`) took the
 *     "animate" branch (display = 0) while the client took the "skip
 *     animation, render value" branch when reduced-motion was set →
 *     server "0" vs client "103" → React #418.
 *   - `prefersReducedMotion` is read inside `useEffect`, never during
 *     render. After mount we either jump straight to `value` (reduced
 *     motion) or kick off the rAF count-up.
 *   - Number formatting uses an explicit `en-ZA` locale so the same value
 *     produces the same string on every host (Vercel fn vs SA browser).
 *     The locale-less `toLocaleString()` was a latent hydration hazard
 *     when host defaults disagreed.
 */
const NUMBER_FMT = new Intl.NumberFormat("en-ZA");

export default function AnimatedNumber({ value, className, style, duration = 700 }: Props) {
  // Always start at 0 — same on SSR and client first render. No env probes
  // during render; that's what made the old version unsafe.
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    // Read reduced-motion preference here (post-mount) — safe to touch
    // `window`. If the user prefers reduced motion, jump straight to value
    // on the next frame; if they don't, run the rAF count-up.
    //
    // We schedule both branches via rAF so the post-hydration state update
    // is async (lint rule react/no-cascading-effects: never call setState
    // synchronously inside an effect body).
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId = 0;

    if (reduced) {
      rafId = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(rafId);
    }

    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
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
      {NUMBER_FMT.format(display)}
    </span>
  );
}
