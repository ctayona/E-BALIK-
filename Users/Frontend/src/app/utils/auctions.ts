import { useCallback, useEffect, useRef, useState } from "react";
import { emitSystemEvent } from "./system";

/** Auction Hall client: typed API, live countdown helpers and a polling feed hook. */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export type AuctionState = "scheduled" | "live" | "awaiting" | "ended" | "cancelled";

export interface Auction {
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
  status: AuctionState;
  is_open: boolean;
  leader: string | null;
  winner: string | null;
  winning_amount: number | null;
  sold: boolean;
  cancel_reason: string | null;
  my_state?: "leading" | "outbid" | "awaiting" | "won" | "lost" | "cancelled";
  my_best_bid?: number | null;
}

export interface AuctionBid { id: string; bidder: string; amount: number; created_at: string; is_mine: boolean }
export interface AuctionComment { id: string; author: string; body: string; created_at: string; is_mine: boolean }
export interface AuctionDetail {
  auction: Auction;
  bids: AuctionBid[];
  comments: AuctionComment[];
  viewer: { signed_in: boolean; is_leading: boolean; is_winner: boolean; my_best_bid: number | null };
  server_time: string;
}
export interface AuctionFeed { live: Auction[]; past: Auction[]; server_time: string }

export class AuctionRequestError extends Error {
  status: number;
  setupRequired: boolean;
  minBid?: number;
  /** Set when the server refused the request because the account is not verified. */
  verificationRequired = false;
  constructor(message: string, status: number, setupRequired = false, minBid?: number) {
    super(message);
    this.name = "AuctionRequestError";
    this.status = status;
    this.setupRequired = setupRequired;
    this.minBid = minBid;
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = localStorage.getItem("ebalik_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/auctions${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  } catch {
    throw new AuctionRequestError("Can't reach the server. Check your connection.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : "Something went wrong.";
    if (data.maintenance) emitSystemEvent({ code: "maintenance", message });
    else if (token && data.session_revoked) emitSystemEvent({ code: "session_revoked", message });
    else if (token && data.suspended) emitSystemEvent({ code: "suspended", message, until: data.suspended_until });
    const failure = new AuctionRequestError(message, response.status, Boolean(data.setup_required), typeof data.min_bid === "number" ? data.min_bid : undefined);
    failure.verificationRequired = Boolean(data.verification_required);
    throw failure;
  }
  return data as T;
}

export const auctionsApi = {
  feed: () => request<AuctionFeed>(""),
  detail: (id: string) => request<AuctionDetail>(`/${encodeURIComponent(id)}`),
  mine: () => request<{ auctions: Auction[]; server_time: string }>("/mine"),
  bid: (id: string, amount: number) => request<{ success: boolean; message: string; auction: Auction; extended: boolean }>(`/${encodeURIComponent(id)}/bids`, { method: "POST", body: { amount } }),
  comment: (id: string, body: string) => request<{ comment: AuctionComment }>(`/${encodeURIComponent(id)}/comments`, { method: "POST", body: { body } }),
  removeComment: (id: string, commentId: string) => request<{ success: boolean }>(`/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" }),
};

export const peso = (value: number | null | undefined) =>
  `₱${(value ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Whole pesos without decimals for compact tiles (₱1,250). Falls back to two decimals for centavos. */
export const pesoShort = (value: number | null | undefined) => {
  const amount = value ?? 0;
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;
};

/** Ticks once a second; every countdown on screen shares it. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function serverOffset(serverTime?: string) {
  const parsed = serverTime ? Date.parse(serverTime) : NaN;
  return Number.isFinite(parsed) ? parsed - Date.now() : 0;
}

/** "2d 4h", "3h 12m", "12m 08s", "8s"; "" once the time has passed. */
export function formatRemaining(ms: number) {
  if (ms <= 0) return "";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatWhen(value?: string | null) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function timeAgo(value: string, now: number) {
  const diff = Math.max(0, now - Date.parse(value));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Remaining milliseconds on a live auction relative to the server clock. */
export function msLeft(auction: Pick<Auction, "ends_at">, now: number, offset: number) {
  return Date.parse(auction.ends_at) - (now + offset);
}

/**
 * Polls the public auction feed. `setupRequired` is true when the Supabase migration has not been run yet,
 * so pages can show a friendly "opening soon" state instead of an error.
 */
export function useAuctionFeed(intervalMs = 15000) {
  const [feed, setFeed] = useState<AuctionFeed | null>(null);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await auctionsApi.feed();
      if (!alive.current) return;
      setFeed(data);
      setOffset(serverOffset(data.server_time));
      setError("");
      setSetupRequired(false);
    } catch (reason) {
      if (!alive.current) return;
      if (reason instanceof AuctionRequestError && reason.setupRequired) setSetupRequired(true);
      else setError(reason instanceof Error ? reason.message : "Unable to load auctions.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, intervalMs);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [refresh, intervalMs]);

  return { feed, error, setupRequired, loading, offset, refresh };
}
