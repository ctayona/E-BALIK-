import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

/** Admin Auctions API. Reads throw `AuctionSetupError` when the Supabase migration has not been applied yet. */

export type AuctionStatus = "scheduled" | "live" | "awaiting" | "ended" | "cancelled";
/** Where an auction is in its life. A won auction is "awaiting_pickup" until the winner has paid and collected, then "completed". */
export type AuctionStage = "scheduled" | "live" | "awaiting_admin" | "awaiting_pickup" | "completed" | "forfeited" | "no_bids" | "cancelled";

export interface AuctionPerson { account_id: string; name: string; campus_id: string; email: string }

export interface AdminAuction {
  id: string;
  reference: string;
  title: string;
  description: string;
  category: string;
  location: string;
  image_url: string;
  gallery: string[];
  starting_price: number;
  bid_increment: number;
  buyout_price?: number | null;
  bought_out?: boolean;
  current_price: number;
  min_next_bid: number;
  bid_count: number;
  starts_at: string;
  ends_at: string;
  original_ends_at: string;
  extension_count: number;
  anti_snipe_enabled: boolean;
  anti_snipe_window_seconds: number;
  anti_snipe_extension_seconds: number;
  max_extensions: number;
  status: AuctionStatus;
  is_open: boolean;
  leader: string | null;
  leader_detail: AuctionPerson | null;
  winner: string | null;
  winner_detail: AuctionPerson | null;
  winning_amount: number | null;
  sold: boolean;
  cancel_reason: string | null;
  fulfillment_status: "awaiting_pickup" | "collected" | "forfeited" | null;
  winner_notified_at: string | null;
  ended_at?: string | null;
  winner_email_mode: string | null;
  finalized_at?: string | null;
  reaction_count?: number;
  reauctioned_from?: string | null;
  /** The winner did not collect within 72 hours: forfeited by the scheduler and ready to be listed again. */
  reauction_ready?: boolean;
  auto_forfeited_at?: string | null;
  pickup_warning_sent_at?: string | null;
  reauction_reason?: string | null;
  created_at: string;
  stage: AuctionStage;
  archived?: boolean;
  archived_at?: string | null;
}

export interface AuctionStats { live: number; scheduled: number; ended: number; awaiting_admin?: number; awaiting_pickup: number; completed?: number; archived?: number; reauction_ready?: number; total_bids: number; sales_total: number }
export interface AuctionList { auctions: AdminAuction[]; stats: AuctionStats; server_time: string; min_custody_days: number }

export interface EligibleItem {
  id: string;
  reference: string;
  name: string;
  category: string;
  description: string;
  location: string;
  storage: string;
  photo: string;
  found_date: string | null;
  days_in_custody: number;
  /** Held for the recommended number of days. Younger items can still be auctioned after an explicit confirmation. */
  recommended: boolean;
}

export interface AuctionBidRow { id: string; name: string; campus_id: string; amount: number; created_at: string }
export interface AuctionCommentRow { id: string; name: string; campus_id: string; body: string; created_at: string; hidden: boolean }
export interface AuctionReactorRow { name: string; campus_id: string; created_at: string }
export interface AuctionDetail { auction: AdminAuction; bids: AuctionBidRow[]; comments: AuctionCommentRow[]; reactors?: AuctionReactorRow[]; server_time: string }

export interface AuctionForm {
  found_item_reference?: string;
  title?: string;
  description?: string;
  starting_price?: string | number;
  bid_increment?: string | number;
  buyout_price?: string | number | null;
  duration_minutes?: number;
  starts_at?: string;
  ends_at?: string;
  anti_snipe_enabled?: boolean;
  anti_snipe_window_seconds?: number;
  anti_snipe_extension_seconds?: number;
  max_extensions?: number;
  gallery?: string[];
  /** Confirms that the administrator wants to auction an item held for fewer than the recommended days. */
  allow_early?: boolean;
}

export class AuctionSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuctionSetupError";
  }
}

async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/${path}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503 && payload.setup_required) throw new AuctionSetupError(String(payload.error));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load auctions");
  }
  return payload as T;
}

async function mutate<T = { success: boolean; message?: string }>(path: string, method: "POST" | "PATCH" | "DELETE", title: string, body?: unknown): Promise<T> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/${path}`, {
    method,
    headers: getAuthHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, title);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `${title} failed`);
  return payload as T;
}

export const fetchAdminAuctions = () => read<AuctionList>("auctions");
export const fetchAdminAuctionDetail = (id: string) => read<AuctionDetail>(`auctions/${encodeURIComponent(id)}`);
/** How many items have been in custody long enough to auction, for the dashboard. */
export const fetchAuctionReadySummary = () => read<{ count: number; oldest_days: number; min_custody_days: number }>("auctions/eligible-items?summary=1");
export const fetchEligibleAuctionItems = () => read<{ items: EligibleItem[]; min_custody_days: number; unclaimed_total: number; recommended_total: number }>("auctions/eligible-items");

export const createAdminAuction = (form: AuctionForm) => mutate("auctions", "POST", "Create auction", form);
export const updateAdminAuction = (id: string, form: AuctionForm) => mutate(`auctions/${encodeURIComponent(id)}`, "PATCH", "Update auction", form);
export const cancelAdminAuction = (id: string, reason: string) => mutate(`auctions/${encodeURIComponent(id)}/cancel`, "POST", "Cancel auction", { reason });
export interface ReauctionForm {
  starting_price?: string | number;
  bid_increment?: string | number;
  duration_minutes?: number;
  reason?: string;
  suspend_days?: number | null;
}
export const finalizeAdminAuction = (id: string) => mutate<{ success: boolean; outcome: "finalized" | "cancelled"; message?: string }>(`auctions/${encodeURIComponent(id)}/finalize`, "POST", "Confirm auction result");
export const reauctionAdminAuction = (id: string, form: ReauctionForm) => mutate<{ success: boolean; auction_id?: string; message?: string; suspension?: { applied: boolean; days?: number; error?: string } | null }>(`auctions/${encodeURIComponent(id)}/reauction`, "POST", "Re-auction item", form);
export const resendAdminWinnerEmail = (id: string) => mutate<{ success: boolean; message?: string; mode?: string }>(`auctions/${encodeURIComponent(id)}/resend-winner-email`, "POST", "Resend winner email");
export const endAdminAuction = (id: string) => mutate(`auctions/${encodeURIComponent(id)}/end`, "POST", "End auction early");
export const setAdminAuctionFulfillment = (id: string, action: "collected" | "forfeited") => mutate(`auctions/${encodeURIComponent(id)}/fulfillment`, "POST", action === "collected" ? "Complete auction" : "Forfeit auction sale", { action });
export const extendAdminAuctionPickup = (id: string) => mutate(`auctions/${encodeURIComponent(id)}/extend-pickup`, "POST", "Give the winner more time");
export const moderateAuctionComment = (id: string, commentId: string, hidden: boolean) => mutate(`auctions/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, "PATCH", hidden ? "Hide comment" : "Restore comment", { hidden });
export const deleteAdminAuction = (id: string) => mutate(`auctions/${encodeURIComponent(id)}`, "DELETE", "Delete auction");

export const peso = (value: number | null | undefined) =>
  `₱${(value ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
