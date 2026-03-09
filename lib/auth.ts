import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { UserRole } from "./types";

export const ROLES: Record<string, UserRole> = {
  LOGGER: "LOGGER",
  DASHBOARD: "DASHBOARD",
  ADMIN: "ADMIN",
};

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
