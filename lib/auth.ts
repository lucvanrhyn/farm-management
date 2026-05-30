import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { UserRole } from "./types";
import { getFarmsForUser, isPlatformAdmin } from "./meta-db";
import { getSafeNext } from "./auth-redirect";
import type { Session } from "next-auth";
import type { SessionFarm } from "@/types/next-auth";
import { redirect } from "next/navigation";

export const ROLES: Record<string, UserRole> = {
  LOGGER: "LOGGER",
  DASHBOARD: "DASHBOARD",
  ADMIN: "ADMIN",
};

/**
 * Returns the user's role for a specific farm, or null if they have no access.
 * Always use this instead of session.user.role for authorization checks —
 * session.user.role is the global max across all farms and is NOT safe for per-farm checks.
 */
export function getUserRoleForFarm(session: Session, slug: string): string | null {
  const farms = session.user?.farms as SessionFarm[] | undefined;
  return farms?.find((f) => f.slug === slug)?.role ?? null;
}

/**
 * Re-fetches the user's farm roles directly from the DB (bypasses JWT cache).
 * Use on destructive ADMIN operations (bulk resets, tenant-wide settings
 * PATCH) to protect against stale permissions in the JWT.
 *
 * The `jwt` callback in auth-options.ts only refreshes farms on explicit
 * `useSession().update()` trigger — regular session reads use cached farms
 * from sign-in. That means a revoked ADMIN's JWT can still carry the ADMIN
 * role until the next re-sign-in or update() trigger. This function closes
 * that gap for the operations where stale-ADMIN would be catastrophic.
 */
export async function verifyFreshAdminRole(userId: string, slug: string): Promise<boolean> {
  const farms = await getFarmsForUser(userId);
  return farms.find((f) => f.slug === slug)?.role === "ADMIN";
}

export function dbRoleToUserRole(dbRole: string): UserRole {
  switch (dbRole) {
    case "admin":
      return "ADMIN";
    case "field_logger":
      return "LOGGER";
    case "viewer":
      return "DASHBOARD";
    default:
      return "DASHBOARD";
  }
}

export function getSession() {
  return getServerSession(authOptions);
}

export function getRoleHomePath(role: UserRole): string {
  switch (role) {
    case "LOGGER":
      return "/logger";
    case "DASHBOARD":
      return "/dashboard";
    case "ADMIN":
      return "/admin";
  }
}

// ─── Redirect-guards (#522) ─────────────────────────────────────────────────
//
// Three composable Server-Component guards that redirect on auth failure.
// Page sites call these instead of calling getServerSession/authOptions
// directly — that migration is tracked in #523.
//
// The deep-link mechanism copies the `/login?next=<encoded path>` precedent
// established in app/[farmSlug]/onboarding/layout.tsx (lines 207-209).
// getSafeNext() from lib/auth-redirect.ts validates the value before it
// reaches the redirect so open-redirect injection is impossible.

/**
 * Require an authenticated session.
 *
 * On success, returns the Session so callers can use it without a second
 * round-trip. On failure, redirects to `/login?next=<currentPath>` (deep-link
 * preserved) — or just `/login` when no currentPath is provided.
 *
 * @param currentPath  The URL path the user was trying to access. Pass it so
 *   the login page can redirect back after sign-in. Use `getSafeNext()` or
 *   read from Next.js `params`/`headers` at the call site.
 */
export async function requireSession(currentPath?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    const safe = currentPath ? getSafeNext(currentPath) : null;
    const destination = safe
      ? `/login?next=${encodeURIComponent(safe)}`
      : "/login";
    redirect(destination);
  }
  return session;
}

/**
 * Require that the authenticated session carries ADMIN role for a given farm.
 *
 * Intended to be called with the session returned by `requireSession()` so
 * there is no extra getSession() round-trip.
 *
 * Redirects to `/login` on non-ADMIN (LOGGER, DASHBOARD, or no access).
 * The redirect target can be customised by the caller if needed — for now
 * `/login` is consistent with the existing layout.tsx patterns.
 */
export async function requireFarmAdmin(
  session: Session,
  farmSlug: string,
): Promise<void> {
  const role = getUserRoleForFarm(session, farmSlug);
  if (role !== "ADMIN") {
    redirect("/login");
  }
}

/**
 * Require platform-admin privileges.
 *
 * FAIL-CLOSED: wraps the meta-store call in try/catch. Any error — network
 * timeout, bad token, meta-db unreachable — is treated as NOT-admin and
 * triggers a redirect. Granting access on an error would be catastrophic.
 *
 * Redirects to `/login` on failure; the platform-admin pages live under a
 * separate `/admin/consulting/**` tree (not farm-scoped) so there is no
 * meaningful `next=` to preserve.
 */
export async function requirePlatformAdmin(session: Session): Promise<void> {
  const email = session.user?.email;
  // No email in session → cannot be platform admin
  if (!email) {
    redirect("/login");
    return;
  }
  try {
    const isAdmin = await isPlatformAdmin(email);
    if (!isAdmin) {
      redirect("/login");
    }
  } catch {
    // Meta-store unreachable or threw — fail closed, never allow.
    redirect("/login");
  }
}
