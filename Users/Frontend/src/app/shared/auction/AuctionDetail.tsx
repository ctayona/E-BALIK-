import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CheckCircle2, Clock3, Gavel, MapPin, MessageCircle, ShieldCheck, Trash2, Trophy, TrendingDown } from "lucide-react";
import Gallery from "@/app/shared/auction/Gallery";
import { AuctionClock } from "@/app/shared/auction/AuctionParts";
import {
  AuctionRequestError, auctionsApi, formatRemaining, formatWhen, msLeft, peso, pesoShort, serverOffset, timeAgo, useNow,
  type Auction, type AuctionDetail as Detail,
} from "@/app/utils/auctions";
import { CX } from "@/app/utils/clay";

const POLL_MS = 5000;
const MAX_COMMENT = 500;

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "gold" | "urgent" }) {
  return (
    <div className="rounded-2xl border border-line bg-frost-50 px-4 py-3">
      <dt className="text-[12.5px] font-medium text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight tabular-nums ${tone === "gold" ? "text-gold-700" : tone === "urgent" ? "text-rose-600" : "text-navy-800"}`}>{value}</dd>
    </div>
  );
}

function initials(name: string) {
  const parts = name.replace(".", "").split(" ").filter(Boolean);
  return `${parts[0]?.[0] ?? "?"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export default function AuctionDetail({ auction: summary, signedIn, focus, onClose, onChanged, onSignIn }: {
  auction: Auction;
  signedIn: boolean;
  focus?: "comments";
  onClose: () => void;
  onChanged: () => void;
  /** Signed-out visitors (landing page) get a "Log in to bid" button that calls this. */
  onSignIn?: () => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const commentsRef = useRef<HTMLElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [amount, setAmount] = useState(String(summary.min_next_bid));
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [showAllBids, setShowAllBids] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState("");
  const now = useNow();

  const load = useCallback(async () => {
    try {
      const data = await auctionsApi.detail(summary.id);
      setDetail(data);
      setOffset(serverOffset(data.server_time));
      setLoadError("");
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Unable to load this auction.");
    }
  }, [summary.id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (restore && document.contains(restore)) restore.focus();
    };
  }, []);

  // Opened from the comment button: bring the conversation into view once the content has rendered.
  const scrolledToComments = useRef(false);
  useEffect(() => {
    if (focus === "comments" && detail && !scrolledToComments.current) {
      scrolledToComments.current = true;
      commentsRef.current?.scrollIntoView({ block: "start" });
    }
  }, [focus, detail]);

  const a = detail?.auction ?? summary;
  const viewer = detail?.viewer;
  const left = msLeft(a, now, offset);
  const open = a.status === "live" && left > 0;
  const minBid = a.min_next_bid;

  // If another bidder raises the price, lift the amount field to the new minimum.
  useEffect(() => {
    setAmount((current) => (Number(current) < minBid ? String(minBid) : current));
    setArmed(false);
  }, [minBid]);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const value = Number(amount);
  const validAmount = Number.isFinite(value) && value >= minBid && value <= 10_000_000;

  const placeBid = async () => {
    if (!validAmount) { setNotice({ type: "error", text: `Your bid must be at least ${peso(minBid)}.` }); return; }
    if (!armed) { setArmed(true); setNotice(null); return; }
    setBusy(true);
    setArmed(false);
    try {
      const result = await auctionsApi.bid(a.id, Math.round(value * 100) / 100);
      setNotice({ type: "ok", text: result.message });
      await load();
      onChanged();
    } catch (reason) {
      if (reason instanceof AuctionRequestError) {
        setNotice({ type: "error", text: reason.message });
        if (reason.minBid) setAmount(String(reason.minBid));
        await load();
      } else {
        setNotice({ type: "error", text: "The bid could not be placed. Try again." });
      }
    } finally {
      setBusy(false);
    }
  };

  const postComment = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = commentText.trim();
    if (!body || commentBusy) return;
    setCommentBusy(true);
    setCommentError("");
    try {
      await auctionsApi.comment(a.id, body);
      setCommentText("");
      await load();
    } catch (reason) {
      setCommentError(reason instanceof Error ? reason.message : "The comment could not be posted.");
    } finally {
      setCommentBusy(false);
    }
  };

  const removeComment = async (id: string) => {
    try {
      await auctionsApi.removeComment(a.id, id);
      await load();
    } catch (reason) {
      setCommentError(reason instanceof Error ? reason.message : "The comment could not be deleted.");
    }
  };

  const bids = detail?.bids ?? [];
  const visibleBids = showAllBids ? bids : bids.slice(0, 5);
  const comments = detail?.comments ?? [];
  const chips = [minBid, minBid + a.bid_increment, minBid + a.bid_increment * 2, minBid + a.bid_increment * 5];
  const snipeText = a.anti_snipe_enabled
    ? `Bids in the last ${Math.round(a.anti_snipe_window_seconds / 60)} min add ${Math.round(a.anti_snipe_extension_seconds / 60)} min, up to ${a.max_extensions} times.`
    : "This auction closes exactly on time.";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-950/70 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="ui-modal-panel relative flex h-[94dvh] w-full max-w-[1120px] flex-col overflow-hidden rounded-t-[28px] border border-white/70 bg-white shadow-overlay sm:h-[min(90dvh,840px)] sm:rounded-[28px] lg:flex-row">
        <div className="relative shrink-0 bg-navy-950 lg:w-[52%]">
          <Gallery images={a.gallery} alt={a.title} aspect="aspect-[4/3] max-h-[38dvh] lg:aspect-auto lg:max-h-none lg:h-full" className="lg:h-full" />
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Back to auctions" className="glass-dark absolute left-3 top-3 flex size-11 items-center justify-center rounded-full">
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <AuctionClock auction={a} now={now} offset={offset} className="absolute right-3 top-3" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5 sm:p-7">
            <header>
              <p className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-gold-700">
                <Gavel size={14} aria-hidden="true" /> Lot {a.reference || "—"}
                {a.category && <span className="font-medium text-ink-muted">{a.category}</span>}
              </p>
              <h2 id={titleId} className="mt-1 font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.01em] text-navy-800 sm:text-[30px]">{a.title}</h2>
              {a.location && <p className="mt-1.5 flex items-center gap-1.5 text-[14px] text-ink-muted"><MapPin size={14} aria-hidden="true" /> Found at {a.location}</p>}
            </header>

            <dl className="grid grid-cols-3 gap-2.5">
              <Stat label={a.bid_count === 0 ? "Starting bid" : "Current bid"} value={pesoShort(a.current_price)} tone="gold" />
              <Stat label={open ? "Time left" : a.status === "scheduled" ? "Opens" : "Closed"} value={open ? (formatRemaining(left) || "Closing") : a.status === "scheduled" ? formatWhen(a.starts_at) : formatWhen(a.ends_at) || "—"} tone={open && left < 5 * 60000 ? "urgent" : "default"} />
              <Stat label="Bids" value={String(a.bid_count)} />
            </dl>

            {a.status === "live" || a.status === "scheduled" ? (
              <p className="flex items-start gap-2.5 rounded-2xl border border-gold-200 bg-gold-50 px-4 py-3 text-[13.5px] leading-6 text-ink-soft">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-gold-700" aria-hidden="true" />
                <span>{snipeText}{a.extension_count > 0 && <strong className="ml-1 text-navy-800"> Extended {a.extension_count}×.</strong>}</span>
              </p>
            ) : null}

            {viewer?.is_winner && (
              <div className="rounded-2xl border border-tide-200 bg-tide-50 px-4 py-4 text-tide-700" role="status">
                <p className="flex items-center gap-2 font-semibold"><Trophy size={17} aria-hidden="true" /> You won this auction at {peso(a.winning_amount)}.</p>
                <p className="mt-1 text-[14px] leading-6">Bring your original ID to the Lost and Found Office to pay and collect the item. We also sent you a notice.</p>
              </div>
            )}
            {a.status === "ended" && !viewer?.is_winner && (
              <p className="rounded-2xl border border-line bg-frost-50 px-4 py-3 text-[14px] leading-6 text-ink-soft">{a.sold ? `Sold to ${a.winner} for ${peso(a.winning_amount)}.` : "This auction ended without any bids."}</p>
            )}
            {a.status === "cancelled" && (
              <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] leading-6 text-rose-800">This auction was cancelled.{a.cancel_reason ? ` ${a.cancel_reason}` : ""}</p>
            )}
            {open && viewer?.my_best_bid != null && !viewer.is_leading && (
              <p className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] font-medium text-rose-800" role="status"><TrendingDown size={16} aria-hidden="true" /> You've been outbid. Your best bid was {peso(viewer.my_best_bid)}.</p>
            )}

            {a.description && <p className="whitespace-pre-line text-[15px] leading-7 text-ink-soft">{a.description}</p>}

            <section aria-labelledby={`${titleId}-bids`}>
              <h3 id={`${titleId}-bids`} className="mb-2 flex items-center gap-2 font-[family-name:var(--font-heading)] text-[17px] font-semibold text-navy-800"><Clock3 size={16} className="text-gold-700" aria-hidden="true" /> Bid history</h3>
              {bids.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[14px] text-ink-muted">No bids yet. Be the first to bid.</p>
              ) : (
                <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                  {visibleBids.map((bid, index) => (
                    <li key={bid.id} className={`flex items-center gap-3 px-4 py-2.5 ${index === 0 ? "bg-gold-50" : ""}`}>
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy-800 text-[12px] font-bold text-white" aria-hidden="true">{initials(bid.bidder)}</span>
                      <span className="min-w-0 flex-1 text-[14px]">
                        <span className="font-semibold text-ink">{bid.is_mine ? "You" : bid.bidder}</span>
                        {index === 0 && <span className="ml-2 rounded-full bg-gold-500 px-2 py-0.5 text-[11.5px] font-bold text-navy-950">Leading</span>}
                        <span className="block text-[12.5px] text-ink-muted">{timeAgo(bid.created_at, now)}</span>
                      </span>
                      <span className="font-semibold tabular-nums text-navy-800">{peso(bid.amount)}</span>
                    </li>
                  ))}
                </ol>
              )}
              {bids.length > 5 && <button type="button" onClick={() => setShowAllBids((v) => !v)} className="mt-2 text-[13.5px] font-semibold text-iris-700 hover:underline">{showAllBids ? "Show fewer bids" : `Show all ${bids.length} bids`}</button>}
            </section>

            <section ref={commentsRef} aria-labelledby={`${titleId}-comments`}>
              <h3 id={`${titleId}-comments`} className="mb-2 flex items-center gap-2 font-[family-name:var(--font-heading)] text-[17px] font-semibold text-navy-800"><MessageCircle size={16} className="text-gold-700" aria-hidden="true" /> Comments <span className="text-[14px] font-medium text-ink-muted">{comments.length}</span></h3>
              {a.status !== "cancelled" && (signedIn ? (
                <form onSubmit={postComment} className="mb-3">
                  <label className="sr-only" htmlFor={`${titleId}-comment`}>Write a comment</label>
                  <textarea id={`${titleId}-comment`} value={commentText} onChange={(e) => setCommentText(e.target.value.slice(0, MAX_COMMENT))} rows={2} placeholder="Ask about the item's condition or pickup…" className={`${CX.input} w-full resize-y py-3 leading-6`} />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-[12.5px] tabular-nums text-ink-muted">{commentText.length}/{MAX_COMMENT}</span>
                    <button type="submit" disabled={!commentText.trim() || commentBusy} className={`${CX.btnNavy} min-h-[40px] px-4 text-[13.5px]`}>{commentBusy ? "Posting…" : "Post comment"}</button>
                  </div>
                  {commentError && <p role="alert" className="mt-2 text-[13.5px] text-rose-700">{commentError}</p>}
                </form>
              ) : <p className="mb-3 text-[14px] text-ink-muted">Sign in to join the conversation.</p>)}
              {comments.length === 0 ? (
                <p className="text-[14px] text-ink-muted">No comments yet.</p>
              ) : (
                <ul className="space-y-3">
                  {comments.map((comment) => (
                    <li key={comment.id} className="flex gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-frost-100 text-[12px] font-bold text-navy-700" aria-hidden="true">{initials(comment.author)}</span>
                      <div className="min-w-0 flex-1 rounded-2xl bg-frost-50 px-4 py-2.5">
                        <p className="flex items-center gap-2 text-[13px]"><span className="font-semibold text-ink">{comment.is_mine ? "You" : comment.author}</span><span className="text-ink-muted">{timeAgo(comment.created_at, now)}</span>
                          {comment.is_mine && <button type="button" onClick={() => void removeComment(comment.id)} aria-label="Delete your comment" className="ml-auto text-ink-muted hover:text-rose-600"><Trash2 size={14} aria-hidden="true" /></button>}
                        </p>
                        <p className="mt-0.5 whitespace-pre-line break-words text-[14.5px] leading-6 text-ink-soft">{comment.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {loadError && <p role="alert" className="text-[13.5px] text-rose-700">{loadError}</p>}
          </div>

          <footer className="shrink-0 border-t border-line bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-7">
            {open && signedIn && viewer?.is_leading ? (
              <p className="flex items-center gap-2 text-[14.5px] font-semibold text-tide-700" role="status"><CheckCircle2 size={18} aria-hidden="true" /> You're the highest bidder at {peso(a.current_price)}.</p>
            ) : open && signedIn ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick amounts">
                  {chips.map((chip) => (
                    <button key={chip} type="button" onClick={() => { setAmount(String(chip)); setArmed(false); }} className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold tabular-nums transition-colors ${Number(amount) === chip ? "border-gold-500 bg-gold-50 text-gold-800" : "border-line text-ink-soft hover:border-gold-400"}`}>{pesoShort(chip)}</button>
                  ))}
                </div>
                <div className="flex gap-2.5">
                  <label className="relative min-w-0 flex-1">
                    <span className="sr-only">Your bid in pesos</span>
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-semibold text-ink-muted" aria-hidden="true">₱</span>
                    <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setArmed(false); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void placeBid(); } }} className={`${CX.input} w-full pl-8 font-semibold tabular-nums`} />
                  </label>
                  <button type="button" onClick={() => void placeBid()} disabled={busy || !validAmount} className={`${armed ? CX.btnNavy : CX.btnGold} min-h-[44px] shrink-0 px-5`}>
                    {busy ? "Placing…" : armed ? `Confirm ${pesoShort(value)}` : "Place bid"}
                  </button>
                </div>
                <p className="text-[12.5px] text-ink-muted">Minimum {peso(minBid)}. Bids are binding. {armed ? "Tap again to confirm." : ""}</p>
              </div>
            ) : open ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[14.5px] text-ink-soft">Sign in with your UMak account to place a bid.</p>
                {onSignIn && <button type="button" onClick={onSignIn} className={`${CX.btnGold} min-h-[44px] px-6`}>Log in to bid</button>}
              </div>
            ) : a.status === "scheduled" ? (
              <p className="text-[14.5px] text-ink-soft">Bidding opens {formatWhen(a.starts_at)}. Starting bid {peso(a.starting_price)}.</p>
            ) : (
              <p className="text-[14.5px] font-medium text-ink-soft">Bidding is closed.</p>
            )}
            {notice && <p role={notice.type === "error" ? "alert" : "status"} className={`mt-2 text-[13.5px] font-medium ${notice.type === "error" ? "text-rose-700" : "text-tide-700"}`}>{notice.text}</p>}
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
