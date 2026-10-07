import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

export type BinType = "claim" | "found_item" | "missing_item" | "user" | "auction" | "evidence";

export interface BinItem {
  archive_id: string;
  entity_type: BinType;
  entity_id: string;
  label: string;
  reason: "admin_delete" | "retention";
  summary: Record<string, number>;
  file_count: number;
  deleted_by: string;
  deleted_at: string;
  expires_at: string;
  days_left: number | null;
}

export class BinSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinSetupError";
  }
}

export async function fetchRecycleBin(type = "", query = ""): Promise<{ items: BinItem[]; retention_days: number }> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (query.trim()) params.set("q", query.trim());
  const response = await fetch(`${API_URL}/api/admin/recycle-bin${params.size ? `?${params}` : ""}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503 && payload.code === "setup_required") throw new BinSetupError(String(payload.error));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load the recycle bin");
  }
  return payload as { items: BinItem[]; retention_days: number };
}

async function post(id: string, action: "restore" | "purge", title: string, body: Record<string, unknown>) {
  const response = await adminMutationRequest(`${API_URL}/api/admin/recycle-bin/${encodeURIComponent(id)}/${action}`, {
    method: "POST", headers: getAuthHeaders(), body: JSON.stringify(body),
  }, title);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `${title} failed`);
  return payload as { success: boolean; message?: string };
}

export const restoreBinItem = (id: string) => post(id, "restore", "Restore from Recycle bin", { confirmation: "CONFIRM" });
export const purgeBinItem = (id: string, authenticatorCode: string) => post(id, "purge", "Delete permanently", { confirmation: "CONFIRM", authenticator_code: authenticatorCode });
