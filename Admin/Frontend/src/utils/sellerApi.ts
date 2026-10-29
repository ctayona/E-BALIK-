import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

/** Seller auctions (office side): listings people want to sell, paying sellers after a sale, and the fee terms. */

export class SellerSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SellerSetupError";
  }
}

export type PayoutMethod = "cash" | "gcash" | "maya" | "bank";
export type ListingStatus = "pending" | "changes_requested" | "listed" | "rejected" | "withdrawn" | "returned";

export interface SellerTerms {
  enabled: boolean; rate: number; minimum: number; cap: number; hold_days: number; max_active: number;
  min_price: number; max_price: number; durations: number[]; conditions: Record<string, string>; payout_methods: Record<PayoutMethod, string>; max_photos: number;
}

export interface SellerPayoutView {
  id: string; status: "holding" | "paid" | "cancelled"; gross: number; commission: number; commission_rate: number; payout_amount: number;
  ready_at: string | null; ready: boolean; collected: boolean; method: PayoutMethod | null; reference: string; receipt_no: string | null; paid_at: string | null;
  has_proof: boolean; cancelled_reason: string; created_at: string;
}

export interface SellerListingAdmin {
  id: string; title: string; category: string; condition: string; description: string; starting_price: number; buyout_price: number | null; duration_days: number;
  photos: string[]; status: ListingStatus; status_label: string; phase: string; next_step: string; review_note: string; created_at: string; reviewed_at: string | null;
  item_received_at: string | null; returned_at: string | null;
  payout_method: PayoutMethod; payout_method_label: string; payout_account_name: string; payout_account_number: string;
  fee: { rate: number; minimum: number; cap: number; on_price: number; commission: number; you_get: number };
  auction: { id: string; status: string; stage: string; current_price: number; bid_count: number; starts_at: string; ends_at: string; winning_amount: number | null; payment_confirmed: boolean } | null;
  payout: SellerPayoutView | null;
  seller: { account_id: string; name: string; campus_id: string; email: string; verification_status: string };
  reviewed_by: string; can_approve: boolean; can_return: boolean;
}

export interface SellerListingList { listings: SellerListingAdmin[]; counts: Record<ListingStatus, number>; terms: SellerTerms }

export type PayoutState = "waiting_pickup" | "on_hold" | "ready" | "paid" | "cancelled";
export interface PayoutRow extends SellerPayoutView {
  auction_id: string; title: string; submission_id: string; state: PayoutState;
  seller: { account_id: string; name: string; campus_id: string; email: string };
  buyer_name: string; paid_by: string; notes: string;
  destination: { method: PayoutMethod; label: string; account_name: string; account_number: string };
}
export interface PayoutList {
  payouts: PayoutRow[];
  totals: { owed: number; owed_count: number; ready: number; ready_count: number; paid: number; paid_count: number; commission: number; gross: number; cancelled_count: number };
  terms: SellerTerms; methods: Record<PayoutMethod, string>;
}

async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/${path}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503 && payload.setup_required) throw new SellerSetupError(String(payload.error));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load seller auctions");
  }
  return payload as T;
}

async function send<T>(path: string, method: "POST" | "PUT", title: string, body: unknown): Promise<T> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/${path}`, { method, headers: getAuthHeaders(), body: JSON.stringify(body) }, title);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `${title} failed`);
  return payload as T;
}

export const fetchSellerListings = (status = "") => read<SellerListingList>(`auctions/submissions${status ? `?status=${encodeURIComponent(status)}` : ""}`);

export interface ReviewInput { action: "approve" | "request_changes" | "reject"; note?: string; item_received?: boolean; bid_increment?: string; starts_at?: string }
export const reviewSellerListing = (id: string, input: ReviewInput) => {
  const titles = { approve: "Approve listing", request_changes: "Request changes", reject: "Reject listing" } as const;
  return send<{ message: string; listing: SellerListingAdmin }>(`auctions/submissions/${encodeURIComponent(id)}/review`, "POST", titles[input.action], input);
};
export const returnSellerListing = (id: string, note: string) => send<{ message: string }>(`auctions/submissions/${encodeURIComponent(id)}/return`, "POST", "Return item to seller", { note });

export const fetchPayouts = (status = "") => read<PayoutList>(`income/payouts${status ? `?status=${encodeURIComponent(status)}` : ""}`);
export const fetchPayoutProofUrl = async (id: string) => (await read<{ url: string }>(`income/payouts/${encodeURIComponent(id)}/proof`)).url;
export const fetchSellerTerms = async () => (await read<{ terms: SellerTerms }>("income/seller-terms")).terms;
export const saveSellerTerms = (terms: Pick<SellerTerms, "enabled" | "rate" | "minimum" | "cap" | "hold_days" | "max_active">) =>
  send<{ message: string; terms: SellerTerms }>("income/seller-terms", "PUT", "Save seller fee terms", terms);

/** Record that the seller was paid. E-bank payouts need the transfer reference and the transfer receipt image. */
export async function payPayout(id: string, input: { method: PayoutMethod; reference: string; notes: string; proof?: File | null }) {
  const form = new FormData();   // multipart: the browser adds the boundary, so no JSON content type here
  form.append("method", input.method);
  form.append("reference", input.reference);
  form.append("notes", input.notes);
  if (input.proof) form.append("proof", input.proof);
  const token = localStorage.getItem("ebalik_admin_token");
  const response = await adminMutationRequest(`${API_URL}/api/admin/income/payouts/${encodeURIComponent(id)}/pay`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }, "Send seller payout");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Send seller payout failed");
  return payload as { message: string; receipt: { receipt_no: string } };
}
