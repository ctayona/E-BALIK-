import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

/** System control extras: scheduled maintenance windows, role-based session wipe, staff account health, email health, audit export. Super admin only. */

export interface MaintenanceWindow { id: string; start: string; end: string; message: string; created_at?: string }
export interface WindowList { windows: MaintenanceWindow[]; locked_now: boolean; max_hours: number; max_windows: number }

export type WipeRole = "user" | "guard" | "admin";
export interface WipeState { wipes: Record<WipeRole, { ts: string; by: string } | null>; counts: Record<WipeRole, number> }

export type Severity = "ok" | "info" | "warn" | "fail";
export interface StaffFlag { code: string; severity: Severity; text: string }
export interface StaffAccount {
  account_id: string; name: string; email: string; role: "super_admin" | "admin" | "guard"; active: boolean; mfa: boolean | null;
  last_login_at: string | null; idle_days: number | null; failed_logins: number; locked: boolean; status: Severity; flags: StaffFlag[];
}
export interface AdminHealth {
  checked_at: string; status: Severity;
  summary: { total: number; by_role: Record<string, number>; flagged: number; without_mfa: number; locked: number; dormant: number; mfa_available: boolean };
  accounts: StaffAccount[];
}

export interface EmailHealth {
  provider: string | null; configured: boolean; sender: string | null; status: Severity; detail: string;
  stats: { sent: number; failed: number; last_ok_at: string | null; last_fail_at: string | null; last_error: string };
  live: { ok: boolean; status_code: number | null; detail: string; plan: string | null } | null;
}

export interface BackupInfo {
  ok?: boolean; at?: string; failed_at?: string; error?: string; file?: string; bytes?: number; tables?: number | null; rows?: number; files?: number;
  encrypted?: boolean; kind?: string; where?: string;
}
export interface BackupStatus { status: Severity; detail: string; last: BackupInfo | null; age_hours: number | null }

async function read<T>(path: string, fallback: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/system/${path}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : fallback);
  return payload as T;
}

async function change<T>(path: string, method: "POST" | "DELETE", title: string, body?: unknown): Promise<T> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/system/${path}`, {
    method, headers: getAuthHeaders(), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, title);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `${title} failed`);
  return payload as T;
}

export const fetchWindows = () => read<WindowList>("maintenance-windows", "Unable to load the maintenance windows");
export const scheduleWindow = (start: Date, end: Date, message: string) =>
  change<{ window: MaintenanceWindow }>("maintenance-windows", "POST", "Schedule maintenance window", { start: start.toISOString(), end: end.toISOString(), message });
export const cancelWindow = (id: string) => change<{ success: boolean }>(`maintenance-windows/${encodeURIComponent(id)}`, "DELETE", "Cancel maintenance window");

export const fetchWipeState = () => read<WipeState>("session-wipe", "Unable to load the session wipes");
export const wipeSessions = (roles: WipeRole[]) => change<{ success: boolean; message: string }>("session-wipe", "POST", "Sign out roles", { roles });

export const fetchAdminHealth = () => read<AdminHealth>("admin-health", "Unable to check the staff accounts");
export const fetchBackupStatus = () => read<BackupStatus>("backup-status", "Unable to check the backups");
export const fetchEmailHealth = () => read<EmailHealth>("email-health", "Unable to check the email service");

/** Downloads the audit log (activity log) as CSV for a range of Manila days. Returns how many rows it holds. */
export async function downloadAuditLog(start: string, end: string): Promise<{ rows: number; truncated: boolean }> {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const response = await fetch(`${API_URL}/api/admin/system/audit-export${params.size ? `?${params}` : ""}`, { headers: getAuthHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to export the audit log");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `ebalik-audit-log-${start || "start"}-to-${end || "today"}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { rows: Number(response.headers.get("X-Rows") || 0), truncated: response.headers.get("X-Truncated") === "true" };
}

/** The monthly report for the Lost and Found Office (/api/admin/reports/monthly). Sections that cannot be built yet come back null. */
export interface RankedCount { name: string; count: number }
export interface MonthlyFigures {
  found_received: number | null; lost_filed: number | null; returned: number | null; claims_filed: number | null;
  income: { total: number; auction: number; smart_tag: number; commission?: number; other: number; refunds: number; auctions_sold: number; tags_sold: number; seller_sales?: number } | null;
}
export interface MonthlyReport {
  month: string; label: string; generated_at: string; start: string; end: string; previous_label: string;
  figures: MonthlyFigures; previous: MonthlyFigures; changes: Record<string, number | null>;
  intake: { found_by_category: RankedCount[]; found_by_location: RankedCount[]; lost_by_category: RankedCount[]; lost_by_location: RankedCount[] } | null;
  claims: { filed: number; by_status: Record<string, number>; returned: number; average_days_to_return: number | null } | null;
  waiting: { total: number; buckets: { label: string; count: number }[] } | null;
  match_alerts: { sent: number } | null;
  smart_tags: { registered: number } | null;
  payments: { confirmed: number; refunds: number; adjustments: number; by_method: { method: string; count: number; amount: number }[]; proofs_sent: number; proofs_by_status: Record<string, number>; proofs_waiting_now: number } | null;
  auctions: { listed: number; by_status: Record<string, number>; bids: number; finalized: number } | null;
  people: { registered: number; verifications_reviewed: number } | null;
  activity: { total: number; failed: number; by_module: RankedCount[] } | null;
}

export async function fetchMonthlyReport(month: string): Promise<MonthlyReport> {
  const response = await fetch(`${API_URL}/api/admin/reports/monthly?month=${encodeURIComponent(month)}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to build the monthly report");
  return payload as MonthlyReport;
}

export async function downloadMonthlyReport(month: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/admin/reports/monthly/export?month=${encodeURIComponent(month)}`, { headers: getAuthHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to export the monthly report");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `ebalik-report-${month}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Restoring a backup (super admin): read and check the file, then restore chosen tables behind an authenticator code. Nothing here deletes data. */
export interface RestoreTable { name: string; rows: number; current: number | null; kind: "normal" | "sensitive" | "protected"; restorable: boolean; note: string }
export interface RestorePreview {
  created_at: string | null; age_days: number | null; project: string | null; same_project: boolean; includes_photos: boolean; file_sha256: string;
  tables: RestoreTable[]; total_rows: number; confirm_phrase: string; sensitive_phrase: string;
  maintenance_on: boolean; authenticator_enabled: boolean; backup_status: Severity; running: boolean;
}
export interface RestoreJob {
  state: "running" | "done" | "partial" | "failed"; started_at?: string; finished_at?: string; by?: string; total_tables?: number;
  done_tables?: string[]; rows?: number; current?: string; failed?: Record<string, string>; error?: string;
}

/** A multipart request must not carry our JSON content type: the browser adds the boundary itself. */
const uploadHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("ebalik_admin_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function upload<T>(path: string, form: FormData, fallback: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/system/restore/${path}`, { method: "POST", headers: uploadHeaders(), body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : fallback);
  return payload as T;
}

export function previewRestore(file: File, passphrase: string): Promise<RestorePreview> {
  const form = new FormData();
  form.append("backup", file);
  form.append("passphrase", passphrase);
  return upload<RestorePreview>("preview", form, "Unable to read the backup");
}

export interface StartRestoreInput {
  file: File; passphrase: string; fileSha256: string; tables: string[]; confirmPhrase: string; sensitivePhrase: string; authenticatorCode: string;
}

export function startRestore(input: StartRestoreInput): Promise<{ job: RestoreJob }> {
  const form = new FormData();
  form.append("backup", input.file);
  form.append("passphrase", input.passphrase);
  form.append("file_sha256", input.fileSha256);
  form.append("tables", JSON.stringify(input.tables));
  form.append("confirm_phrase", input.confirmPhrase);
  form.append("sensitive_phrase", input.sensitivePhrase);
  form.append("authenticator_code", input.authenticatorCode);
  form.append("acknowledge", "yes");
  return upload<{ job: RestoreJob }>("execute", form, "Unable to start the restore");
}

export const fetchRestoreStatus = () => read<{ job: RestoreJob | null; running: boolean }>("restore/status", "Unable to check the restore");
