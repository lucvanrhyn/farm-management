import Link from "next/link";

/**
 * Global 404 page (Phase C, bug C2).
 *
 * Why this file exists
 * ────────────────────
 * Before Phase C every unauthenticated request to a path that did not match
 * the proxy.ts allow-list was 307'd to /login regardless of whether the path
 * was actually a real route. SEO crawlers following dead external links
 * landed on the auth wall (and could index it as the canonical destination
 * for the broken URL). Legitimate human typos got no signal that the path
 * was bad — they just saw the login form and assumed they were logged out.
 *
 * The fix has two halves:
 *   1. proxy.ts now lets unknown paths fall through to Next instead of
 *      redirecting unauthenticated users on every miss (see
 *      `KNOWN_PROTECTED_PREFIXES` in proxy.ts).
 *   2. This file exists so Next has a 404 component to render. Without
 *      app/not-found.tsx Next would render its built-in dev-only 404 in
 *      production, which is jarring and unbranded.
 *
 * Keep this server-rendered (no "use client") so the bundle stays tiny.
 * Anyone hitting a 404 should not pay the cost of the React client runtime.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-stone-500">
        404
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-md text-base text-stone-600">
        The page you tried to open does not exist. It may have been moved or
        the link you followed could be broken.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-stone-700"
        >
          Go home
        </Link>
        <Link
          href="/farms"
          className="inline-flex items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50"
        >
          My farms
        </Link>
      </div>
    </main>
  );
}
