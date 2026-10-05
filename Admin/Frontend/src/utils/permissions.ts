import { getStoredAdmin } from "./api";

/**
 * Role-based access control for the admin UI. Mirrors the server rules:
 * admins can create, read and update; only super admins can delete or change access levels.
 * The server enforces every rule independently — these helpers only shape the interface.
 */
export type AdminRole = "admin" | "super_admin";

export function getAdminRole(): AdminRole {
  return getStoredAdmin()?.access_level === "super_admin" ? "super_admin" : "admin";
}

export function isSuperAdmin(): boolean {
  return getAdminRole() === "super_admin";
}

/** Delete actions (items, claims, users) are reserved for super admins. */
export function canDelete(): boolean {
  return isSuperAdmin();
}

/** Changing another account's access level is reserved for super admins. */
export function canManageAccess(): boolean {
  return isSuperAdmin();
}

export const ROLE_LABEL: Record<AdminRole, string> = { admin: "Admin", super_admin: "Super admin" };
