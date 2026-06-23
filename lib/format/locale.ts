/**
 * SSR-stable locale formatting helpers.
 *
 * THE BUG THIS CLOSES (React #418 hydration mismatch)
 * ---------------------------------------------------
 * Locale-less `Number.prototype.toLocaleString()` formats with the HOST's
 * default locale. The Vercel server runtime resolves that to en-US ("1,234")
 * while a South African browser resolves it to en-ZA ("1 234"). When a client
 * component renders such a string on first paint, the server HTML and the
 * client's first render disagree once the value crosses 1000 → React #418
 * (the "intermittent, count-dependent" mismatch).
 *
 * `components/admin/AnimalsTable.tsx`'s old behaviour was the textbook case;
 * `components/admin/AnimatedNumber.tsx` already fixed its own copy this exact
 * way (issue #259/#283). This module is the single shared home for that fix so
 * every count formats identically on the Vercel function and the SA browser.
 *
 * The app is South-Africa-only (`<html lang="en-ZA">`, SARS tax, SA farms), so
 * pinning en-ZA is the correct locale, not merely a hydration workaround.
 */

// Module-level so the formatter is constructed once, not per render.
const NUMBER_FMT = new Intl.NumberFormat("en-ZA");

/**
 * Format an integer/number with the pinned en-ZA locale. Use this everywhere a
 * count is rendered in a Client Component instead of `value.toLocaleString()`,
 * whose output depends on the (server vs browser) host default locale.
 */
export function formatNumber(value: number): string {
  return NUMBER_FMT.format(value);
}
