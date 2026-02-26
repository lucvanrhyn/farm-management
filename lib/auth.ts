import { UserRole } from "./types";

// Placeholder auth — no real authentication yet.
// Will be replaced with role-based PIN/password auth in Phase 1.

export const ROLES: Record<string, UserRole> = {
  LOGGER: "LOGGER",
  DASHBOARD: "DASHBOARD",
  ADMIN: "ADMIN",
};

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
