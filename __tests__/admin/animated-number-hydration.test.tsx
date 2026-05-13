// @vitest-environment jsdom
/**
 * Issue #259 — React #418 hydration mismatch on Operations Overview.
 *
 * Root cause: `<AnimatedNumber value={n} />` called `prefersReducedMotion()`
 * during the render body. On the server this returned `false` (no `window`),
 * so the initial render was `display = animatedDisplay = 0` → `"0"`. On the
 * client first render (pre-effect), if the user had `prefers-reduced-motion`
 * set, `prefersReducedMotion()` returned `true` → `display = value` →
 * server "0" vs client "103" → React #418.
 *
 * Even without reduced-motion, `display.toLocaleString()` with no explicit
 * locale arg produced locale-different output between Node (server) and the
 * browser when host defaults disagreed.
 *
 * Fix invariants pinned by these tests:
 *   1. Initial SSR render MUST be "0" regardless of `value` and regardless
 *      of whether `window.matchMedia` exists or is missing — i.e. the
 *      component MUST NOT touch `window` during render.
 *   2. Post-mount, the formatted output uses an explicit `en-ZA` locale so
 *      it never falls back to host-default `toLocaleString()`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import AnimatedNumber from "@/components/admin/AnimatedNumber";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Restore window.matchMedia between tests.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("AnimatedNumber — hydration safety (issue #259)", () => {
  it("SSR render produces '0' even when window.matchMedia is missing (no env probe during render)", () => {
    // Simulate the server: no matchMedia on window. The pre-fix component
    // wrapped the call in `typeof window !== "undefined"`, so on jsdom
    // (which has `window` but we delete `matchMedia`) it would throw a
    // TypeError. Post-fix, render must succeed and produce "0".
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    const html = renderToString(<AnimatedNumber value={103} />);
    // Strip span tags to get the raw text.
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toBe("0");
  });

  it("SSR render produces '0' regardless of matchMedia outcome (reduced=true)", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: true, media: "" }) as MediaQueryList),
    });
    const html = renderToString(<AnimatedNumber value={103} />);
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toBe("0");
  });

  it("SSR render produces '0' regardless of matchMedia outcome (reduced=false)", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: false, media: "" }) as MediaQueryList),
    });
    const html = renderToString(<AnimatedNumber value={103} />);
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toBe("0");
  });

  it("does NOT call window.matchMedia during SSR render", () => {
    const matchMediaFn = vi.fn(
      () => ({ matches: false, media: "" }) as MediaQueryList,
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: matchMediaFn,
    });
    renderToString(<AnimatedNumber value={103} />);
    // SSR render must be free of `matchMedia` calls — that read belongs in
    // useEffect (which renderToString never executes).
    expect(matchMediaFn).not.toHaveBeenCalled();
  });

  it("post-mount with reduced-motion settles on the value formatted in en-ZA (NBSP-style separators, never commas)", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(
        (q: string) =>
          ({ matches: q.includes("reduce"), media: q }) as MediaQueryList,
      ),
    });
    const { container, findByText } = render(
      <AnimatedNumber value={1234567} />,
    );
    // After mount, reduced-motion path sets display = value synchronously.
    await findByText((content) => content.replace(/\D/g, "") === "1234567");
    const text = container.textContent ?? "";
    // en-ZA uses NBSP (U+00A0) or narrow-NBSP (U+202F) separators — never a
    // comma (which would mean en-US fallback).
    expect(text).not.toMatch(/,/);
    expect(text.replace(/\D/g, "")).toBe("1234567");
  });
});
