import { useEffect, useState } from "react";
import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

/**
 * Role access (Users > Role access) and page locks (System control > Page isolation).
 * `useMyAccess` feeds the console shell: which pages this person may open, and which are locked while they are being fixed.
 */

export type StaffRole = "admin" | "guard";
export interface MyAccess {
  level: "guard" | "admin" | "super_admin";
  pages: string[];
  locked: Record<string, { message: string; since: string | null }>;
  bypass_locks: boolean;
}
export interface AdminPageInfo { id: string; label: string; grantable: boolean; always: boolean; super_only: boolean }
export interface UserPageInfo { id: string; label: string; api_locked: boolean }
export interface RoleAccess {
  matrix: Record<StaffRole, string[]>;
  defaults: Record<StaffRole, string[]>;
  admin_pages: AdminPageInfo[];
  user_pages: UserPageInfo[];
}
export interface PageLock { message: string; since: string | null; by?: string }
export interface PageLocks {
  user: Record<string, PageLock>;
  admin: Record<string, PageLock>;
  admin_pages: AdminPageInfo[];
  user_pages: UserPageInfo[];
}

const EVENT = "ebalik-access-updated";

async function readJson<T>(path: string, fallback: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/${path}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : fallback);
  return payload as T;
}

async function send<T>(path: string, body: unknown, title: string): Promise<T> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/${path}`, { method: "PUT", headers: getAuthHeaders(), body: JSON.stringify(body) }, title);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `${title} failed`);
  window.dispatchEvent(new Event(EVENT));
  return payload as T;
}

export const fetchMyAccess = () => readJson<MyAccess>("access/me", "Unable to load your access");
export const fetchRoleAccess = () => readJson<RoleAccess>("access", "Unable to load role access");
export const saveRoleAccess = (matrix: Record<StaffRole, string[]>) => send<{ matrix: Record<StaffRole, string[]>; message: string }>("access", matrix, "Save role access");
export const fetchPageLocks = () => readJson<PageLocks>("system/page-locks", "Unable to load the page locks");
export const setPageLock = (area: "user" | "admin", page: string, locked: boolean, message = "") =>
  send<{ user: Record<string, PageLock>; admin: Record<string, PageLock>; message: string }>("system/page-locks", { area, page, locked, message }, locked ? "Lock page" : "Unlock page");

/** The signed-in staff member's pages and locks; refreshed when a super admin changes them and every 60 seconds. `null` until loaded. */
export function useMyAccess(enabled: boolean): MyAccess | null {
  const [access, setAccess] = useState<MyAccess | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const load = () => { void fetchMyAccess().then((value) => { if (active) setAccess(value); }).catch(() => { /* keep the last answer; the server still enforces */ }); };
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 60000);
    window.addEventListener(EVENT, load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener(EVENT, load); };
  }, [enabled]);
  return access;
}
