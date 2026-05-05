/**
 * Safe `?next=` parsing for the login redirect chain.
 *
 * Visual audit P1 (2026-05-04): the proxy now stamps `?next=<pathname>`
 * onto the login redirect so the user lands back on the page they tried
 * to open. The `next` value is user-controllable (anyone can craft
 * `/login?next=//evil.example`), so the login page MUST sanitise it
 * before passing it to `window.location.assign`. This module owns that
 * single source of truth.
 *
 * Allow:  same-origin absolute paths (`/farms`, `/<slug>/admin?x=1`)
 * Reject: protocol-relative URLs (`//evil.example`), backslash variants
 *         (`\\\\evil.example`), absolute URLs with a scheme
 *         (`https://evil.example`), and anything that doesn't start with
 *         a single `/`.
 */
export function getSafeNext(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  // Reject any value not starting with a single `/`.
  if (value[0] !== '/') return null;

  // Reject protocol-relative URLs and the backslash variant browsers
  // happily resolve as off-origin: `//evil`, `/\\evil`, `/\evil`.
  if (value[1] === '/' || value[1] === '\\') return null;

  // Reject control characters that some user agents quietly strip when
  // resolving — no legitimate path needs them.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(value)) return null;

  return value;
}
