import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

/** Mission Control (super admin): announcement banner, messages, administrators, audit export, storage and email test. */

export type AnnouncementTone = "info" | "success" | "warning" | "critical";
export interface Announcement { live: boolean; tone: AnnouncementTone; title: string; message: string; updated_at: string | null }

export interface FoundUser { account_id: string; name: string; email: string; campus_id: string; level: "user" | "admin" | "super_admin"; is_active: boolean }
export interface MessageInput { audience: "user" | "all"; account_id?: string; title: string; message: string; send_email: boolean; send_in_app: boolean }
export interface MessageResult {
  success: boolean; message: string; recipients: number; in_app: number; email_queued: number; email_unavailable: boolean;
  email_sent?: number; email_failed?: number;
}

export interface AdminAccount {
  account_id: string; name: string; email: string; campus_id: string; level: "admin" | "super_admin";
  is_active: boolean; mfa_enabled: boolean; created_at: string | null; last_login_at: string | null;
}

export interface BucketStat { bucket: string; objects: number; bytes: number }
export interface StorageOverview { buckets: BucketStat[]; total_objects: number; total_bytes: number; image_objects: number; image_bytes: number }
export interface OrphanScan { buckets: { bucket: string; count: number; bytes: number }[]; total: number; bytes: number; min_age_hours: number }
export interface CleanResult { success: boolean; message: string; removed: number; failed: number; freed_bytes: number }

export interface EmailTestResult { ok: boolean; to: string; provider: string; detail: string; status_code: number | null; from?: string }

/** Thrown when a read needs the 20261010 migration. The page shows setup steps instead of an error. */
export class SetupRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupRequiredError";
  }
}

async function read<T>(path: string, fallback: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/system/${path}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503 && payload.setup_required) throw new SetupRequiredError(String(payload.error));
    throw new Error(typeof payload.error === "string" ? payload.error : fallback);
  }
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

export const saveAnnouncement = (input: { live: boolean; tone: AnnouncementTone; title: string; message: string }) =>
  mutate<{ success: boolean; announcement: Announcement; message: string }>("announcement", "PUT", input.live ? "Publish announcement banner" : "Save announcement banner", input);

export async function searchUsers(query: string): Promise<FoundUser[]> {
  return (await read<{ users: FoundUser[] }>(`users/search?q=${encodeURIComponent(query)}`, "Unable to search users")).users;
}
export const sendMessage = (input: MessageInput) => mutate<MessageResult>("messages", "POST", "Send message", input);

export const fetchAdmins = () => read<{ admins: AdminAccount[]; you: string }>("admins", "Unable to load the administrators");
export const revokeAdminAccess = (accountId: string) =>
  mutate<{ success: boolean; message: string; name: string }>(`admins/${encodeURIComponent(accountId)}/revoke`, "POST", "Revoke administrator access");

export const fetchStorage = () => read<StorageOverview>("storage", "Unable to load the storage statistics");
export const scanOrphans = () => mutate<OrphanScan>("storage/scan", "POST", "Scan for orphaned images");
export const cleanOrphans = () => mutate<CleanResult>("storage/clean", "POST", "Clean orphaned images");
export const sendTestEmail = () => mutate<EmailTestResult>("email-test", "POST", "Email delivery test");

/** The export is a file, so it is fetched as a blob (the request needs the admin token) and saved through a temporary link. */
export async function downloadExport(format: "json" | "csv"): Promise<string> {
  const response = await fetch(`${API_URL}/api/admin/system/export?format=${format}`, { headers: getAuthHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to create the export");
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] ?? `ebalik-audit-export.${format === "csv" ? "zip" : "json"}`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
};
