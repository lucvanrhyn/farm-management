"use client";

import { useEffect } from "react";

/**
 * Global runtime for the landed "polish" FX that need JS:
 *   1. Card spotlight — writes --spot-x / --spot-y on the hovered
 *      .ft-card-interactive so the accent wash follows the cursor.
 *   2. KPI count-up — animates the numeric part of any [data-ft-ticker]
 *      element from 0 → value on first paint (and when new ones mount).
 *
 * Mount once, high in an authenticated layout. Respects prefers-reduced-motion.
 */
export function FxRuntime() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // --- 1. Spotlight ------------------------------------------------------
    let frame = 0;
    let lastEvt: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      lastEvt = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const e2 = lastEvt;
        if (!e2) return;
        const target = (e2.target as Element | null)?.closest?.(".ft-card-interactive") as HTMLElement | null;
        if (!target) return;
        const r = target.getBoundingClientRect();
        target.style.setProperty("--spot-x", `${((e2.clientX - r.left) / r.width) * 100}%`);
        target.style.setProperty("--spot-y", `${((e2.clientY - r.top) / r.height) * 100}%`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    // --- 2. Count-up -------------------------------------------------------
    const animated = new WeakSet<Element>();
    const RE = /^(\D*?)(\d[\d,]*\.?\d*)(.*)$/;

    function tick(el: HTMLElement) {
      if (animated.has(el)) return;
      const raw = el.textContent ?? "";
      const m = raw.match(RE);
      if (!m) return;
      animated.add(el);
      if (reduce) return;
      const [, prefix, numStr, suffix] = m;
      const decimals = (numStr.split(".")[1] || "").length;
      const target = parseFloat(numStr.replace(/,/g, ""));
      if (!isFinite(target)) return;
      const hasComma = numStr.includes(",");
      const fmt = (n: number) => {
        const fixed = n.toFixed(decimals);
        return hasComma ? Number(fixed).toLocaleString("en-ZA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fixed;
      };
      const dur = 950;
      const start = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = `${prefix}${fmt(target * eased)}${suffix}`;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = raw;
      };
      requestAnimationFrame(step);
    }

    const tickEl = (el: Element) => tick(el as HTMLElement);
    document.querySelectorAll("[data-ft-ticker]").forEach(tickEl);

    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const el = n as HTMLElement;
          if (el.matches?.("[data-ft-ticker]")) tick(el);
          el.querySelectorAll?.("[data-ft-ticker]").forEach(tickEl);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
      mo.disconnect();
    };
  }, []);

  return null;
}
