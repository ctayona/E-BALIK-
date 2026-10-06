import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

/** Admin Smart Tags API. Reads throw `SmartTagSetupError` when the Supabase migration has not been applied yet. */

export type TagFilter = "all" | "blank" | "claimed" | "lost" | "expired" | "disabled";
export type TagType = "qr" | "rfid" | "nfc";

export interface AdminSmartTag {
  tag_id: string;
  status: "blank" | "active" | "lost" | "expired";
  tag_type: TagType;
  validity_months: number | null;
  valid_until: string | null;
  days_left: number | null;
  batch_id: string | null;
  scan_count: number;
  last_scanned_at: string | null;
  /** True when the owner took a registration photo. Open the tag to load it (a short-lived signed link). */
  has_photo?: boolean;
  is_disabled: boolean;
  disabled_reason: string | null;
  item_name: string;
  batch_label: string;
  created_at: string;
  claimed_at: string | null;
  found_notice_count: number;
  last_found_notice_at: string | null;
  owner: { name: string; email: string; campus_id: string } | null;
  url: string;
}

export interface SmartTagStats { total: number; blank: number; claimed: number; lost: number; expired: number; disabled: number }
export interface TagTypeOption { value: TagType; label: string; enabled: boolean }
export interface TagBatch {
  batch_id: string | null;
  label: string;
  tag_type: TagType;
  validity_months: number | null;
  created_at: string | null;
  total: number; blank: number; active: number; lost: number; expired: number; disabled: number;
  expiring_soon: number;
  scans: number;
  next_expiry: string | null;
  days_to_expiry: number | null;
  all_disabled: boolean;
}
export interface UrlCheck { url: string; ok: boolean; reason: string }
export interface SmartTagList { tags: AdminSmartTag[]; stats: SmartTagStats; tag_url_base: string; max_batch: number; url_check: UrlCheck; tag_types: TagTypeOption[] }
export interface GeneratedBatch {
  count: number; batch_label: string; batch_id: string; tag_type: TagType; validity_months: number | null;
  tag_ids: string[]; values: string[]; tag_url_base: string; url_check?: UrlCheck; message?: string;
}

export class SmartTagSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartTagSetupError";
  }
}

export async function fetchSmartTags(status: TagFilter): Promise<SmartTagList> {
  const response = await fetch(`${API_URL}/api/admin/smart-tags?status=${encodeURIComponent(status)}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503 && payload.setup_required) throw new SmartTagSetupError(String(payload.error));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load Smart Tags");
  }
  return payload as SmartTagList;
}

async function mutate<T>(path: string, title: string, body?: unknown): Promise<T> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/smart-tags/${path}`, {
    method: "POST",
    headers: getAuthHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, title);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `${title} failed`);
  return payload as T;
}

export const generateSmartTagBatch = (count: number, label: string, tagType: TagType, validityMonths: number | null) =>
  mutate<GeneratedBatch & { success: boolean }>("batch", "Generate Smart Tags", { count, label, tag_type: tagType, validity_months: validityMonths });
export const renewSmartTag = (id: string, months: number) => mutate<{ success: boolean; valid_until: string | null }>(`${encodeURIComponent(id)}/renew`, "Renew Smart Tag", { months });
export const deactivateTagBatch = (batchId: string, reason: string) => mutate<{ success: boolean; changed: number }>(`batches/${encodeURIComponent(batchId)}/disable`, "Deactivate Smart Tag batch", { reason });
export const reactivateTagBatch = (batchId: string) => mutate<{ success: boolean; changed: number }>(`batches/${encodeURIComponent(batchId)}/enable`, "Reactivate Smart Tag batch");

export async function fetchTagBatches(): Promise<{ batches: TagBatch[]; warning_days: number }> {
  const response = await fetch(`${API_URL}/api/admin/smart-tags/batches`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503 && payload.setup_required) throw new SmartTagSetupError(String(payload.error));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load the batches");
  }
  return payload as { batches: TagBatch[]; warning_days: number };
}
export const deactivateSmartTag = (id: string, reason: string) => mutate<{ success: boolean }>(`${encodeURIComponent(id)}/disable`, "Deactivate Smart Tag", { reason });
export const reactivateSmartTag = (id: string) => mutate<{ success: boolean }>(`${encodeURIComponent(id)}/enable`, "Reactivate Smart Tag");

export async function fetchSmartTagPhoto(id: string): Promise<string | null> {
  const response = await fetch(`${API_URL}/api/admin/smart-tags/${encodeURIComponent(id)}/photo`, { headers: getAuthHeaders() });
  if (!response.ok) throw new Error("Unable to load the photo");
  const payload = await response.json().catch(() => ({}));
  return typeof payload.url === "string" ? payload.url : null;
}

/** The QR needs the admin's token, so it is fetched as a blob and shown through an object URL. */
export async function fetchSmartTagQr(id: string): Promise<string> {
  const response = await fetch(`${API_URL}/api/admin/smart-tags/${encodeURIComponent(id)}/qr`, { headers: getAuthHeaders() });
  if (!response.ok) throw new Error("Unable to create the QR code");
  return URL.createObjectURL(await response.blob());
}
