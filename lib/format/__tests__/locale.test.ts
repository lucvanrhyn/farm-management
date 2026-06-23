/**
 * @vitest-environment node
 *
 * formatNumber — SSR-stable integer formatting (React #418 class).
 *
 * Locale-less `Number.prototype.toLocaleString()` formats with the HOST's
 * default locale: the Vercel server runtime resolves to en-US ("1,234") while
 * a South African browser resolves to en-ZA ("1 234"). A client component that
 * renders such a string on first paint emits one markup on the server and a
 * different one on the client's first render → React #418 hydration mismatch
 * (the class already fixed for components/admin/AnimatedNumber.tsx, issue
 * #259/#283). Pinning the locale on BOTH sides removes the divergence.
 */
import { describe, it, expect } from "vitest";
import { formatNumber } from "../locale";

describe("formatNumber", () => {
  it("groups thousands with the en-ZA separator, never the en-US comma", () => {
    const s = formatNumber(1234567);
    // A comma separator is the en-US default — the exact thing that diverges
    // from a SA browser and trips #418. en-ZA must never produce one.
    expect(s).not.toContain(",");
    // …and it must actually group (i.e. contain non-digit separators), proving
    // it formatted rather than returning the raw "1234567".
    expect(s.replace(/\d/g, "").length).toBeGreaterThan(0);
  });

  it("is pinned to en-ZA regardless of the host's ambient default locale", () => {
    expect(formatNumber(1234567)).toBe(new Intl.NumberFormat("en-ZA").format(1234567));
  });

  it("leaves sub-thousand integers ungrouped", () => {
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(0)).toBe("0");
  });
});
