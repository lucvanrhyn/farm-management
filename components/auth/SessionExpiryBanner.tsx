"use client";

/**
 * Authenticated-shell banner that surfaces session expiry to the user.
 *
 * Why this exists (P1.6 — production-triage 2026-05-03):
 * --------------------------------------------------------
 * Before this banner, when a session expired the user got:
 *   • silent failure (the next API click 401'd with no toast),
 *   • a redirect to /login that lost their place (post-login → /farms),
 *   • no warning that expiry was imminent.
 *
 * The banner mounts inside <AppShell> so every authenticated route subtree
 * gets it without each page having to opt in. It renders nothing while the
 * session is healthy or while we're on an auth route (/login, /register,
 * /verify-email — those handle their own messaging).
 *
 * Two variants:
 *   • "expiring soon" (role="status"): user can hit "Stay signed in" which
 *     calls `useSession().update()` to ask next-auth to refresh the JWT in
 *     place — no nav, no lost form state.
 *   • "expired" (role="alert"): user can hit "Sign in again" which calls
 *     `signIn(undefined, { callbackUrl })` where callbackUrl is the CURRENT
 *     pathname + search. After successful re-auth next-auth lands them right
 *     back on the page they were on, satisfying acceptance criterion #2
 *     (return-to-page).
 *
 * The proxy already redirects unauthenticated requests to `/login?next=…`
 * (see proxy.ts), but that path only fires when the user clicks something.
 * The banner closes the proactive-detection gap so the user knows BEFORE
 * losing in-flight work to a refresh.
 */

import { signIn, useSession } from "next-auth/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useSessionExpiry } from "@/lib/auth/use-session-expiry";

const AUTH_ROUTE_PREFIXES = ["/login", "/register", "/verify-email"] as const;

function isAuthRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return AUTH_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Build the path the user should land on after re-authenticating. Encoded as
 * the `callbackUrl` value passed to `signIn()`. next-auth's signIn will route
 * through its sign-in page (configured as `/login`) with the callbackUrl
 * preserved; on successful credential submit, the next-auth callbacks
 * default-redirect back to that URL via its allowed-origin policy.
 *
 * The login page itself ALSO reads `?next=` via getSafeNext() (P1 of the
 * visual audit) — we mirror callbackUrl into next= so both code paths land
 * the user on the same destination. getSafeNext() rejects open-redirect
 * attempts at the consumer side as defence-in-depth.
 */
function buildCallbackUrl(
  pathname: string | null,
  searchParams: URLSearchParams,
): string {
  const base = pathname ?? "/farms";
  const search = searchParams.toString();
  return search.length > 0 ? `${base}?${search}` : base;
}

const containerStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 1000,
  padding: "0.625rem 1rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.75rem",
  fontFamily: "var(--font-sans)",
  fontSize: "0.875rem",
  letterSpacing: "0.01em",
  boxShadow: "0 2px 8px rgba(0,0,0,0.20)",
};

const buttonStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.18)",
  border: "1px solid rgba(255,255,255,0.30)",
  borderRadius: "8px",
  padding: "0.375rem 0.75rem",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: "inherit",
  fontWeight: 500,
  cursor: "pointer",
};

export function SessionExpiryBanner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isExpired, isExpiringSoon } = useSessionExpiry();
  const { update } = useSession();
  const [refreshing, setRefreshing] = useState(false);

  // Never show on auth routes — they handle their own UI.
  if (isAuthRoute(pathname)) return null;
  if (!isExpired && !isExpiringSoon) return null;

  if (isExpired) {
    const callbackUrl = buildCallbackUrl(pathname, searchParams);
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          ...containerStyle,
          background: "rgba(180,40,30,0.95)",
          color: "#FFF6EE",
          borderBottom: "1px solid rgba(255,255,255,0.20)",
        }}
      >
        <span>Your session has expired. Sign in again to continue.</span>
        <button
          type="button"
          onClick={() => signIn(undefined, { callbackUrl })}
          style={buttonStyle}
        >
          Sign in again
        </button>
      </div>
    );
  }

  // isExpiringSoon
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        ...containerStyle,
        background: "rgba(196,144,48,0.95)",
        color: "#1A1510",
        borderBottom: "1px solid rgba(0,0,0,0.20)",
      }}
    >
      <span>Your session is about to expire.</span>
      <button
        type="button"
        disabled={refreshing}
        aria-busy={refreshing}
        onClick={async () => {
          setRefreshing(true);
          try {
            await update();
          } finally {
            setRefreshing(false);
          }
        }}
        style={{
          ...buttonStyle,
          background: refreshing
            ? "rgba(0,0,0,0.10)"
            : "rgba(0,0,0,0.18)",
          border: "1px solid rgba(0,0,0,0.30)",
          cursor: refreshing ? "not-allowed" : "pointer",
        }}
      >
        {refreshing ? "Refreshing…" : "Stay signed in"}
      </button>
    </div>
  );
}
