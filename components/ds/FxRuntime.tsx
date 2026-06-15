"use client";

import { useEffect } from "react";

/**
 * Global runtime for the locked Retro "polish" FX that need JS:
 *   1. Magnetic primary buttons — the hovered .ft-btn-primary drifts toward
 *      the cursor, then springs back on leave.
 *   2. Click ripple — a material-style ink ripple on any .ft-btn press.
 *   3. KPI count-up — animates the numeric part of any [data-ft-ticker]
 *      element from 0 → value on first paint (and when new ones mount).
 *
 * Mount once, high in an authenticated layout. Respects prefers-reduced-motion
 * (magnetic + ripple disabled; count-up snaps straight to its final value).
 */
export function FxRuntime() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];

    // --- 1. Magnetic primary buttons --------------------------------------
    let frame = 0;
    let lastEvt: PointerEvent | null = null;
    let magCur: HTMLElement | null = null;
    const resetMag = (el: HTMLElement | null) => {
      if (el) {
        el.style.transform = "";
        el.style.transition = "";
      }
    };
    const onMove = (e: PointerEvent) => {
      lastEvt = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const e2 = lastEvt;
        if (!e2) return;
        const btn = (e2.target as Element | null)?.closest?.(".ft-btn-primary") as HTMLElement | null;
        if (btn !== magCur) {
          resetMag(magCur);
          magCur = btn;
        }
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const dx = e2.clientX - (r.left + r.width / 2);
        const dy = e2.clientY - (r.top + r.height / 2);
        btn.style.transition = "transform .12s ease";
        btn.style.transform = `translate(${(dx * 0.22).toFixed(1)}px, ${(dy * 0.3).toFixed(1)}px)`;
      });
    };
    if (!reduce) {
      window.addEventListener("pointermove", onMove, { passive: true });
      cleanups.push(() => window.removeEventListener("pointermove", onMove));
    }

    // --- 2. Click ripple ---------------------------------------------------
    const onDown = (e: PointerEvent) => {
      const b = (e.target as Element | null)?.closest?.(".ft-btn") as HTMLElement | null;
      if (!b) return;
      const r = b.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.1;
      const ink = document.createElement("span");
      ink.className = "ft-ripple-ink";
      ink.style.width = ink.style.height = `${size}px`;
      ink.style.left = `${e.clientX - r.left - size / 2}px`;
      ink.style.top = `${e.clientY - r.top - size / 2}px`;
      if (getComputedStyle(b).position === "static") b.style.position = "relative";
      b.style.overflow = "hidden";
      b.appendChild(ink);
      window.setTimeout(() => ink.remove(), 620);
    };
    if (!reduce) {
      window.addEventListener("pointerdown", onDown, { passive: true });
      cleanups.push(() => window.removeEventListener("pointerdown", onDown));
    }

    // --- 3. Count-up -------------------------------------------------------
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
      cleanups.forEach((fn) => fn());
      if (frame) cancelAnimationFrame(frame);
      resetMag(magCur);
      mo.disconnect();
    };
  }, []);

  return null;
}
