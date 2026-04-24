import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { UserRole } from "./types";
import { getFarmsForUser } from "./meta-db";
import type { Session } from "next-auth";
import type { SessionFarm } from "@/types/next-auth";

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
