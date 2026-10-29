import { AuctionRequestError } from "./auctions";
import { emitSystemEvent } from "./system";

/** "Sell an item" in the Auction Hall: the seller's own listings, the fee terms, and sending or editing a listing (with photos). */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export interface SellingTerms {
  enabled: boolean;
  rate: number;
  minimum: number;
  /** 0 means no cap. */
  cap: number;
  hold_days: number;
  max_active: number;
  min_price: number;
  max_price: number;
  durations: number[];
  conditions: Record<string, string>;
  payout_methods: Record<string, string>;
  max_photos: number;
}

export type SellingPhase =
  | "pending" | "changes_requested" | "rejected" | "withdrawn" | "returned" | "listed"
  | "scheduled" | "live" | "ending" | "unsold" | "sold" | "paid" | "holding" | "paid_out" | "cancelled";

export interface SellerPayout {
  id: string;
  status: "holding" | "paid" | "cancelled";
  gross: number;
  commission: number;
  commission_rate: number;
  payout_amount: number;
  ready_at: string | null;
  ready: boolean;
  collected: boolean;
  method: string | null;
  receipt_no: string | null;
  paid_at: string | null;
}

export interface SellerListing {
  id: string;
  title: string;
  category: string;
  condition: string;
  description: string;
  starting_price: number;
  buyout_price: number | null;
  duration_days: number;
  photos: string[];
  status: "pending" | "changes_requested" | "listed" | "rejected" | "withdrawn" | "returned";
  status_label: string;
  phase: SellingPhase;
  next_step: string;
  review_note: string;
  created_at: string;
  payout_method: string;
  payout_method_label: string;
  payout_account_name: string;
  /** Masked for the seller ("•••• 4567"). */
  payout_account_number: string;
  fee: { rate: number; minimum: number; cap: number; on_price: number; commission: number; you_get: number };
  auction: { id: string; status: string; stage: string; current_price: number; bid_count: number; starts_at: string; ends_at: string; winning_amount: number | null; payment_confirmed: boolean } | null;
  payout: SellerPayout | null;
  can_edit: boolean;
  can_withdraw: boolean;
  hold_days: number;
}

export interface SellingOverview {
  listings: SellerListing[];
  terms: SellingTerms;
  eligibility: { can_sell: boolean; reason: string };
  totals: { paid_out: number; owed: number; sold: number; active: number };
}

async function send<T>(path: string, options: { method?: string; form?: FormData } = {}): Promise<T> {
  const token = localStorage.getItem("ebalik_token");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/auctions/selling${path}`, { method: options.method ?? "GET", headers, body: options.form });
  } catch {
    throw new AuctionRequestError("Can't reach the server. Check your connection.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : "Something went wrong.";
    if (data.maintenance) emitSystemEvent({ code: "maintenance", message });
    else if (token && data.session_revoked) emitSystemEvent({ code: "session_revoked", message });
    else if (token && data.suspended) emitSystemEvent({ code: "suspended", message, until: data.suspended_until });
    const failure = new AuctionRequestError(message, response.status, Boolean(data.setup_required));
    failure.verificationRequired = Boolean(data.verification_required);
    if (typeof data.code === "string") failure.code = data.code;
    throw failure;
  }
  return data as T;
}

export const sellingApi = {
  terms: () => send<{ terms: SellingTerms }>("/terms"),
  mine: () => send<SellingOverview>(""),
  submit: (form: FormData) => send<{ success: boolean; message: string; listing: SellerListing }>("", { method: "POST", form }),
  update: (id: string, form: FormData) => send<{ success: boolean; message: string; listing: SellerListing }>(`/${encodeURIComponent(id)}`, { method: "PUT", form }),
  withdraw: (id: string) => send<{ success: boolean; message: string; listing: SellerListing }>(`/${encodeURIComponent(id)}/withdraw`, { method: "POST" }),
};

/** The same fee the server charges: rate% rounded to the centavo, at least the minimum, at most the cap (0 = none), never more than the sale. */
export function sellerFee(price: number, terms: Pick<SellingTerms, "rate" | "minimum" | "cap">) {
  const gross = Math.max(0, Math.round(price * 100) / 100);
  let commission = Math.round(gross * terms.rate) / 100;
  commission = Math.max(commission, terms.minimum);
  if (terms.cap > 0) commission = Math.min(commission, terms.cap);
  commission = Math.min(commission, gross);
  return { commission, youGet: Math.round((gross - commission) * 100) / 100 };
}

export const SELL_CATEGORIES = ["Electronics", "Books & School Supplies", "Bags & Luggage", "Clothing", "Accessories", "Sports & Hobbies", "Others"];
