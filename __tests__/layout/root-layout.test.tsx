/**
 * @vitest-environment jsdom
 *
 * __tests__/layout/root-layout.test.tsx
 *
 * Phase D — layout polish.
 *
 * Covers three accessibility / i18n bugs in the root layout:
 *   D1. <html lang> must be en-ZA — every rendered string in the UI is
 *       English ("Sign In", "Create Your Account", …). Declaring af-ZA
 *       made screen readers pronounce English copy with Afrikaans
 *       phonemes (visual audit P1, 2026-05-04). A future per-user
 *       locale system will revisit this once real Afrikaans copy ships.
 *   D2. Layout must render a "skip to content" link as the first
 *       focusable child of <body>, targeting #main.
 *   D3. Skip-link target wrapper must exist and be programmatically
 *       focusable so the in-page anchor jump moves keyboard focus.
 *
 * We render the server component to a static HTML string and parse it
 * via the jsdom environment's DOMParser. That sidesteps the limitation
 * that React Testing Library's `render` cannot mount a full
 * <html>/<body> document tree.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/font/google's factory functions only work inside the Next build
// pipeline (they're transformed into static font CSS). Stub them so the
// layout module can be imported in plain Node — each factory returns the
// `{ variable, className, style }` shape the layout interpolates.
vi.mock("next/font/google", () => {
  const stub = (name: string) => () => ({
    variable: `--font-${name}`,
    className: `font-${name}`,
    style: { fontFamily: name },
  });
  return {
    Geist: stub("geist"),
    Geist_Mono: stub("geist-mono"),
    Playfair_Display: stub("playfair"),
    DM_Sans: stub("dm-sans"),
    DM_Serif_Display: stub("dm-serif"),
  };
});

// Imported after the mock is registered so the factory calls in the module
// body resolve to the stubs above.
const { default: RootLayout } = await import("@/app/layout");

function renderLayout(): Document {
  const html = renderToStaticMarkup(
    <RootLayout>
      <p data-testid="child">child content</p>
    </RootLayout>,
  );
  // The jsdom Vitest environment provides a window-scoped DOMParser that
  // round-trips full <html>/<body> trees. text/html mode is forgiving of
  // the React-emitted markup (no closing slashes on void elements, etc).
  return new DOMParser().parseFromString(`<!doctype html>${html}`, "text/html");
}

describe("RootLayout — D1 lang attribute", () => {
  it("sets <html lang> to en-ZA (matches the rendered English UI copy)", () => {
    const doc = renderLayout();
    expect(doc.documentElement.getAttribute("lang")).toBe("en-ZA");
  });
});

describe("RootLayout — D2 skip-to-content link", () => {
  it("renders a skip link as the first focusable element in <body>", () => {
    const doc = renderLayout();
    const body = doc.body;
    expect(body).not.toBeNull();

    // The first <a> element in the body should be the skip link, pointing
    // at the main content anchor. Anything visually hidden/decorative
    // (icons, hidden inputs) before it would defeat keyboard navigation.
    const firstAnchor = body.querySelector("a");
    expect(firstAnchor, "skip link <a> missing").not.toBeNull();
    expect(firstAnchor?.getAttribute("href")).toBe("#main");
  });

  it("skip link is reachable: it sits before any other anchor or button", () => {
    const doc = renderLayout();
    const focusables = doc.body.querySelectorAll("a, button");
    expect(focusables.length).toBeGreaterThan(0);
    const first = focusables[0] as HTMLAnchorElement;
    expect(first.tagName).toBe("A");
    expect(first.getAttribute("href")).toBe("#main");
  });

  it("skip link uses a class that becomes visible on focus (sr-only-focusable)", () => {
    const doc = renderLayout();
    const link = doc.body.querySelector('a[href="#main"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    // We use Tailwind's `sr-only` + `focus:not-sr-only` pattern so the link is
    // hidden until focused. Either class signals the visually-hidden treatment.
    const className = link?.getAttribute("class") ?? "";
    expect(className).toMatch(/sr-only/);
    expect(className).toMatch(/focus:not-sr-only|focus-visible:not-sr-only/);
  });
});

describe("RootLayout — D2 skip-link target", () => {
  it("wraps children in a focusable #main element so the skip link lands somewhere", () => {
    const doc = renderLayout();
    const target = doc.getElementById("main");
    expect(target, '#main wrapper missing').not.toBeNull();
    // Children render inside the wrapper.
    expect(target?.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it("skip-link target is programmatically focusable (tabIndex=-1)", () => {
    // Without tabIndex, an in-page anchor jump scrolls but does not move
    // keyboard focus on every browser — Safari and Firefox in particular.
    // A wrapper with tabIndex=-1 is the canonical fix.
    const doc = renderLayout();
    const target = doc.getElementById("main");
    expect(target?.getAttribute("tabindex")).toBe("-1");
  });

  it("skip-link target is NOT a <main> element (nested layouts own the landmark)", () => {
    // Several route-segment layouts (e.g. app/[farmSlug]/admin/layout.tsx)
    // already render their own <main>. The root must NOT add a second one
    // — WAI-ARIA mandates a single main landmark per document.
    const doc = renderLayout();
    const target = doc.getElementById("main");
    expect(target?.tagName).not.toBe("MAIN");
  });
});
