import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

/** Income ledger (Auction Hall and Smart Tag sales). Reads throw `IncomeSetupError` until migration 20261022 has been run. */

export type IncomeSource = "auction" | "smart_tag" | "other";
export type IncomeKind = "sale" | "refund" | "adjustment";
export type IncomeMethod = "cash" | "gcash" | "maya" | "bank" | "other";

export interface IncomeMonth { month: string; auction: number; smart_tag: number; other: number; total: number }
export interface IncomePending {
  /** Auctions won but not collected yet, and their winning amounts. */
  auction: number; auction_count: number;
  /** Registered tags waiting for staff approval, where the owner pays. */
  smart_tag: number; smart_tag_count: number;
  /** Unsold blank tags and what they would bring in at their current price. */
  stock_value: number; stock_count: number;
}
export interface IncomeSummary {
  range: { start: string; end: string };
  total: number;
  by_source: Record<IncomeSource, number>;
  refunds: number;
  entries: number;
  sales: number;
  this_month: number;
  previous_month: number;
  by_month: IncomeMonth[];
  pending: IncomePending;
  sources: Record<IncomeSource, string>;
  methods: Record<IncomeMethod, string>;
}
export interface IncomeEntry {
  entry_id: string;
  source: IncomeSource;
  kind: IncomeKind;
  source_ref: string | null;
  description: string;
  amount: number;
  method: IncomeMethod;
  receipt_no: string | null;
  notes: string | null;
  received_at: string;
  payer_name: string;
  recorded_by_name: string;
}
export interface ManualEntryInput {
  kind: IncomeKind;
  source: IncomeSource;
  amount: string;
  description: string;
  method: IncomeMethod;
  receipt_no: string;
  notes: string;
  received_on: string;
  source_ref: string;
}

export class IncomeSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncomeSetupError";
  }
}

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== "") search.set(key, String(value)); });
  return search.size ? `?${search}` : "";
}

async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/income/${path}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503 && payload.setup_required) throw new IncomeSetupError(String(payload.error));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load income");
  }
  return payload as T;
}

export const fetchIncomeSummary = (start = "", end = "") => read<IncomeSummary>(`summary${query({ start, end })}`);
export const fetchIncomeEntries = (start = "", end = "", source = "", limit = 25, offset = 0) =>
  read<{ entries: IncomeEntry[]; total: number; limit: number; offset: number }>(`entries${query({ start, end, source, limit, offset })}`);

export async function addIncomeEntry(input: ManualEntryInput) {
  const response = await adminMutationRequest(`${API_URL}/api/admin/income/entries`, {
    method: "POST", headers: getAuthHeaders(), body: JSON.stringify(input),
  }, "Record income entry");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to record the entry");
  return payload as { success: boolean; entry: IncomeEntry };
}

/** Downloads the ledger as a CSV file (opens in Excel with the peso sign intact). */
export async function downloadIncomeCsv(start = "", end = "", source = "") {
  const response = await fetch(`${API_URL}/api/admin/income/export${query({ start, end, source })}`, { headers: getAuthHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to export the income ledger");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `ebalik-income-${start || "start"}-to-${end || "today"}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const peso = (value: number) => `${value < 0 ? "−" : ""}₱${Math.abs(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
