// @vitest-environment jsdom
/**
 * HomePortal must not format its counts with the ambient-default-locale
 * `Number.prototype.toLocaleString()` — that's the React #418 hydration class.
 *
 * Pre-fix, HomePortal rendered `animalCount.toLocaleString()` /
 * `campCount.toLocaleString()` (no locale arg) in its render body. The Vercel
 * server runtime resolves the default locale to en-US ("1,234") while a SA
 * browser resolves to en-ZA ("1 234"), so once a count crosses 1000 the server
 * HTML and the client's first render diverge → #418. That's exactly the
 * "intermittent, count-dependent" mismatch (basson's 103 head never trips it;
 * a 1000+ herd does).
 *
 * A single-process `renderToString` === `renderToString` check CANNOT catch
 * this (both renders share the test host's one default locale). We instead
 * assert the precise invariant the fix guarantees: counts are formatted via a
 * locale-pinned `Intl.NumberFormat` (lib/format/locale.ts → formatNumber), so
 * `Number.prototype.toLocaleString` is never called locale-less during render.
 *
 * Sibling of home-portal-time-hydration.test.tsx (the clock half of #418).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { cleanup } from "@testing-library/react";

vi.mock("@/hooks/useAssistantName", () => ({
  useAssistantName: () => "Einstein",
}));

import HomePortal from "@/components/home/HomePortal";

const baseProps = {
  farmName: "Trio B Boerdery",
  breed: "Brangus",
  owner: "Luc van Rhyn",
  animalCount: 1234, // ≥1000 so a locale-less separator would diverge
  campCount: 1019,
  sections: { admin: "Herd, camps & data", logger: "Camp rounds", map: "Farm map" },
  mode: "cattle" as const,
  isMultiMode: false,
  onSetMode: () => {},
  onNavigate: () => {},
  onAskEinstein: () => {},
  onSignOut: () => {},
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HomePortal — number-locale hydration safety (#418)", () => {
  it("never formats counts via the ambient-default-locale toLocaleString", () => {
    const spy = vi.spyOn(Number.prototype, "toLocaleString");

    renderToString(<HomePortal {...baseProps} />);

    // Locale-less calls (no args / explicit undefined locale) are the hazard:
    // their output depends on the host default. The fix routes every count
    // through a pinned Intl.NumberFormat instead.
    const localeLessCalls = spy.mock.calls.filter(
      (args) => args.length === 0 || args[0] === undefined,
    );
    expect(localeLessCalls).toEqual([]);
  });
});
