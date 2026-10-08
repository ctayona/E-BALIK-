import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";
import type { Announcement, AnnouncementTone } from "./missionApi";

/** Super Admin Control Panel API (maintenance mode, force logout, health scan, data cleanup). */

export interface MaintenanceState { enabled: boolean; message: string; since: string | null }
export interface CleanupSummary { at: string; by: string; days: number; include_unread: boolean; deleted: Record<string, number> }

export interface SystemOverview {
  maintenance: MaintenanceState;
  sessions_valid_after: string | null;
  last_cleanup: CleanupSummary | null;
  setup_required: boolean;
  min_cleanup_days: number;
  announcement: Announcement;
}

/** `info` is a check that found something worth knowing but nothing to fix (for example, suspended accounts exist). */
export type HealthStatus = "ok" | "info" | "warn" | "fail";
export interface HealthCheck { id: string; title: string; status: HealthStatus; detail: string; items?: string[] }
export interface HealthReport { status: HealthStatus; checked_at: string; duration_ms: number; checks: HealthCheck[] }

export interface CleanupRow { key: string; label: string; count: number; available: boolean }
export interface CleanupPreview { days: number; include_unread: boolean; targets: CleanupRow[]; total: number }

async function read<T>(path: string, fallback: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/system/${path}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : fallback);
  return payload as T;
}

async function mutate<T>(path: string, method: "POST" | "PUT", title: string, body?: unknown): Promise<T> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/system/${path}`, {
    method,
    headers: getAuthHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, title);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `${title} failed`);
  return payload as T;
}

export const fetchSystemOverview = () => read<SystemOverview>("overview", "Unable to load system settings");
export const runHealthCheck = () => read<HealthReport>("health", "Unable to run the health check");
export const fetchCleanupPreview = (days: number, includeUnread: boolean) =>
  read<CleanupPreview>(`cleanup/preview?days=${days}&include_unread=${includeUnread}`, "Unable to preview the cleanup");

export const setMaintenanceMode = (enabled: boolean, message: string) =>
  mutate<{ success: boolean; maintenance: MaintenanceState; message: string }>("maintenance", "PUT", enabled ? "Turn on maintenance mode" : "Turn off maintenance mode", { enabled, message });
export const forceLogoutAllUsers = () =>
  mutate<{ success: boolean; sessions_valid_after: string; message: string }>("force-logout", "POST", "Force logout");
export const runDatabaseCleanup = (days: number, includeUnread: boolean, targets: string[]) =>
  mutate<{ success: boolean; summary: CleanupSummary; message: string }>("cleanup", "POST", "Database cleanup", { days, include_unread: includeUnread, targets });

/** Public maintenance flag. No sign-in needed, so the admin header can show it without extra permissions. */
export async function fetchPublicSystemStatus(): Promise<{ maintenance: boolean; message: string; since: string | null; announcement?: { id: string; tone: AnnouncementTone; title: string; message: string } | null }> {
  const response = await fetch(`${API_URL}/api/system/status`);
  if (!response.ok) throw new Error("status unavailable");
  return response.json();
}
