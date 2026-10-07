import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CheckCircle2, Clock3, Gavel, Heart, Hourglass, ListChecks, MapPin, MessageCircle, ShieldAlert, ShieldCheck, Trash2, Trophy, TrendingDown, Zap } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { isVerified, useCurrentUser } from "@/app/utils/system";
import Gallery from "@/app/shared/auction/Gallery";
import { AuctionClock } from "@/app/shared/auction/AuctionParts";
import {
  AuctionRequestError, auctionsApi, formatRemaining, formatWhen, msLeft, peso, pesoShort, serverOffset, timeAgo, useClosingTick, useNow,
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

/** The Time left tile. It owns the one-second clock so the bids, log and comments below do not re-render each second. */
function TimeTile({ auction, offset, open }: { auction: Auction; offset: number; open: boolean }) {
  const left = msLeft(auction, useNow(), offset);
  const label = open ? "Time left" : auction.status === "scheduled" ? "Opens" : "Closed";
  const value = open ? (formatRemaining(left) || "Closing") : auction.status === "scheduled" ? formatWhen(auction.starts_at) : formatWhen(auction.ends_at) || "—";
  return <Stat label={label} value={value} tone={open && left < 5 * 60000 ? "urgent" : "default"} />;
}

function initials(name: string) {
  if (name.startsWith("Bidder_")) return name.slice(7, 9);  // anonymous alias: show its code, e.g. Bidder_8X9 -> 8X
  const parts = name.replace(".", "").split(" ").filter(Boolean);
  return `${parts[0]?.[0] ?? "?"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export default function AuctionDetail({ auction: summary, signedIn, focus, onClose, onChanged, onSignIn, onVerify }: {
  auction: Auction;
  signedIn: boolean;
  focus?: "comments";
  onClose: () => void;
  onChanged: () => void;
  /** Signed-out visitors (landing page) get a "Log in to bid" button that calls this. */
  onSignIn?: () => void;
  /** Opens the Profile so an unverified user can upload an ID. Shown instead of the bid box. */
  onVerify?: () => void;
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [buyNowChosen, setBuyNowChosen] = useState(false);
  const verified = isVerified(useCurrentUser());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [showAllBids, setShowAllBids] = useState(false);
  const [reacted, setReacted] = useState<boolean | null>(null);
  const [hearts, setHearts] = useState<number | null>(null);
  const heartBusy = useRef(false);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState("");
  const now = useNow(30000);  // only relative times ("5m ago") need this, so a slow clock is enough
  useClosingTick(detail ? [detail.auction] : [summary], offset);  // re-renders once when the auction closes

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
  const open = a.status === "live" && msLeft(a, Date.now(), offset) > 0;
  const minBid = a.min_next_bid;

  // If another bidder raises the price, lift the amount field to the new minimum.
  useEffect(() => {
    setAmount((current) => (Number(current) < minBid ? String(minBid) : current));
  }, [minBid]);

  const value = Number(amount);
  const buyout = a.buyout_price ?? null;
  // Bids sit on a ladder: the starting bid plus whole increments (start 100, step 100 means 100, 200, 300, never 150). Buy Now is always allowed.
  const cents = (n: number) => Math.round(n * 100);
  const onStep = a.bid_increment > 0 && cents(value) >= cents(a.starting_price) && (cents(value) - cents(a.starting_price)) % cents(a.bid_increment) === 0;
  const isBuyNowAmount = buyout !== null && value >= buyout;
  const validAmount = Number.isFinite(value) && value >= minBid && value <= 10_000_000 && (onStep || isBuyNowAmount);
  const nextStep = a.bid_increment > 0 && Number.isFinite(value) && value > 0
    ? Math.max(minBid, a.starting_price + Math.ceil(Math.max(0, cents(value) - cents(a.starting_price)) / cents(a.bid_increment)) * a.bid_increment)
    : minBid;
  const buyNowAvailable = open && buyout !== null && !a.bought_out;
  /** Nobody can bid below the Buy Now price any more: the next bid would already reach it. */
  const buyNowOnly = buyNowAvailable && buyout !== null && minBid >= buyout;
  /** Typing the Buy Now price (or more) is the same as pressing Buy Now: it ends the auction. */
  const isBuyNow = buyNowAvailable && buyout !== null && (buyNowChosen || (validAmount && value >= buyout));
  const payAmount = isBuyNow && buyout !== null ? buyout : value;

  /** Step 1: validate, then ask for confirmation. Bids are binding, so nothing is sent until the user confirms. */
  const requestBid = () => {
    if (!validAmount) {
      setNotice({ type: "error", text: value >= minBid && !onStep ? `Bids go up in exact steps of ${peso(a.bid_increment)}. The next bid you can place near that is ${peso(nextStep)}.` : `Your bid must be at least ${peso(minBid)}.` });
      return;
    }
    setNotice(null);
    setBuyNowChosen(false);
    setConfirmOpen(true);
  };

  const requestBuyNow = () => {
    setNotice(null);
    setBuyNowChosen(true);
    setConfirmOpen(true);
  };

  /** Step 2: send the bid and report the result in a message box. */
  const placeBid = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await auctionsApi.bid(a.id, Math.round(payAmount * 100) / 100);
      setConfirmOpen(false);
      setBuyNowChosen(false);
      showInfoModal(result.bought_out
        ? {
          variant: "success",
          title: "You bought it!",
          message: result.message,
          details: [`You pay: ${peso(buyout)}`, "The auction has ended and no one else can bid.", "Bring your original ID to the Lost and Found Office once an administrator confirms your purchase."],
        }
        : {
          variant: "success",
          title: "Bid placed",
          message: result.message,
          details: [`Your bid: ${peso(value)}`, result.extended ? "The closing time was extended because your bid came in at the last moment." : "You will be notified if someone outbids you."],
        });
      await load();
      onChanged();
    } catch (reason) {
      setConfirmOpen(false);
      setBuyNowChosen(false);
      if (reason instanceof AuctionRequestError) {
        if (reason.suggested) setAmount(String(reason.suggested));
        else if (reason.minBid) setAmount(String(reason.minBid));
        showInfoModal(reason.verificationRequired
          ? { variant: "warning", title: "Verify your account first", message: reason.message, details: ["Open My Profile and upload a school or government ID."] }
          : { variant: "error", title: reason.suggested ? "Bid is between two steps" : reason.minBid ? "Someone bid first" : "Bid not placed", message: reason.message, details: reason.suggested ? [`Next valid bid: ${peso(reason.suggested)}.`] : reason.minBid ? [`The new minimum bid is ${peso(reason.minBid)}.`] : undefined });
        await load();
      } else {
        showInfoModal({ variant: "error", title: "Bid not placed", message: "The bid could not be placed. Try again." });
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
      if (reason instanceof AuctionRequestError && reason.code === "profanity") {
        // Keep what they typed so they can edit it; tell them clearly why it was blocked.
        setCommentError("");
        showInfoModal({
          variant: "warning",
          title: "Comment not posted",
          message: reason.message,
          details: ["Comments with foul or abusive language are blocked automatically.", "Edit your comment and post it again."],
          autoCloseMs: null,
        });
      } else {
        setCommentError(reason instanceof Error ? reason.message : "The comment could not be posted.");
      }
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

  const toggleHeart = async () => {
    if (heartBusy.current || !signedIn) return;
    heartBusy.current = true;
    const current = reacted ?? Boolean(detail?.viewer.reacted);
    const baseCount = hearts ?? a.reaction_count ?? 0;
    setReacted(!current);
    setHearts(Math.max(0, baseCount + (current ? -1 : 1)));
    try {
      const result = await auctionsApi.react(a.id, !current);
      setHearts(result.reaction_count);
      onChanged();
    } catch (reason) {
      setReacted(current);
      setHearts(baseCount);
      showInfoModal({ variant: "error", title: "Heart not saved", message: reason instanceof AuctionRequestError ? reason.message : "Your heart could not be saved. Try again." });
    } finally {
      heartBusy.current = false;
    }
  };
  const isReacted = reacted ?? Boolean(detail?.viewer.reacted);
  const heartCount = hearts ?? a.reaction_count ?? 0;
  const log = detail?.log ?? [];
  const bids = detail?.bids ?? [];
  const visibleBids = showAllBids ? bids : bids.slice(0, 5);
  const comments = detail?.comments ?? [];
  const chips = [minBid, minBid + a.bid_increment, minBid + a.bid_increment * 2, minBid + a.bid_increment * 5].filter((chip) => buyout === null || chip < buyout);
  const buyNowButton = buyNowAvailable && buyout !== null && (
    <button type="button" onClick={requestBuyNow} disabled={busy} className={`${CX.btnNavy} group min-h-[56px] w-full gap-2.5 text-[17px] font-bold`}>
      <Zap size={20} className="text-gold-300 transition-transform group-hover:scale-110" aria-hidden="true" fill="currentColor" />
      Buy Now for {peso(buyout)}
    </button>
  );
  const snipeText = a.anti_snipe_enabled
    ? `Bids in the last ${Math.round(a.anti_snipe_window_seconds / 60)} min add ${Math.round(a.anti_snipe_extension_seconds / 60)} min, up to ${a.max_extensions} times.`
    : "This auction closes exactly on time.";

  return (<>
    {createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-950/70 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="ui-modal-panel relative flex h-[94dvh] w-full max-w-[1120px] flex-col overflow-hidden rounded-t-[28px] border border-white/70 bg-white shadow-overlay sm:h-[min(90dvh,840px)] sm:rounded-[28px] lg:flex-row">
        <div className="relative shrink-0 bg-navy-950 lg:w-[52%]">
          <Gallery images={a.gallery} alt={a.title} aspect="aspect-[4/3] max-h-[38dvh] lg:aspect-auto lg:max-h-none lg:h-full" className="lg:h-full" />
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Back to auctions" className="glass-dark absolute left-3 top-3 flex size-11 items-center justify-center rounded-full">
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <AuctionClock auction={a} offset={offset} className="absolute right-3 top-3" />
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
              <TimeTile auction={a} offset={offset} open={open} />
              <Stat label="Bids" value={String(a.bid_count)} />
            </dl>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void toggleHeart()}
                disabled={!signedIn}
                aria-pressed={isReacted}
                aria-label={isReacted ? "Remove your heart" : "Heart this lot"}
                className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-4 text-[14px] font-semibold transition-colors disabled:cursor-default ${isReacted ? "border-rose-300 bg-rose-50 text-rose-700" : "border-line bg-white text-ink-soft hover:border-rose-300"}`}
              >
                <Heart size={17} aria-hidden="true" fill={isReacted ? "#e11d48" : "none"} color={isReacted ? "#e11d48" : "currentColor"} />
                {isReacted ? "Hearted" : "Heart"}
              </button>
              <span className="text-[13.5px] text-ink-muted tabular-nums">{heartCount === 0 ? (signedIn ? "Be the first to heart this" : "No hearts yet") : `${heartCount} ${heartCount === 1 ? "person likes" : "people like"} this`}</span>
            </div>

            {a.status === "live" || a.status === "scheduled" ? (
              <p className="flex items-start gap-2.5 rounded-2xl border border-gold-200 bg-gold-50 px-4 py-3 text-[13.5px] leading-6 text-ink-soft">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-gold-700" aria-hidden="true" />
                <span>{snipeText}{a.extension_count > 0 && <strong className="ml-1 text-navy-800"> Extended {a.extension_count}×.</strong>}</span>
              </p>
            ) : null}

            {buyout !== null && !a.bought_out && (a.status === "live" || a.status === "scheduled") && (
              <p className="flex items-start gap-2.5 rounded-2xl border border-navy-200 bg-navy-50 px-4 py-3 text-[13.5px] leading-6 text-ink-soft">
                <Zap size={17} className="mt-0.5 shrink-0 text-gold-700" aria-hidden="true" fill="currentColor" />
                <span><strong className="text-navy-800">Buy Now price: {peso(buyout)}.</strong> Pay this and the auction ends right away with you as the winner. Any bid at or above it does the same.</span>
              </p>
            )}

            {viewer?.is_winner && (
              <div className="rounded-2xl border border-tide-200 bg-tide-50 px-4 py-4 text-tide-700" role="status">
                <p className="flex items-center gap-2 font-semibold"><Trophy size={17} aria-hidden="true" /> You won this auction at {peso(a.winning_amount)}.</p>
                <p className="mt-1 text-[14px] leading-6">Bring your original ID to the Lost and Found Office to pay and collect the item. We also sent you a notice.</p>
              </div>
            )}
            {a.status === "awaiting" && (
              <div className="rounded-2xl border border-iris-200 bg-iris-50 px-4 py-4 text-ink-soft" role="status">
                <p className="flex items-center gap-2 font-semibold text-navy-800"><Hourglass size={17} aria-hidden="true" /> {a.bought_out ? "Bought with Buy Now. Waiting for an administrator." : "Bidding has closed. Waiting for an administrator."}</p>
                <p className="mt-1 text-[14px] leading-6">{a.bought_out
                  ? (viewer?.is_leading ? `You bought this item for ${peso(a.winning_amount)}. An administrator will confirm your purchase and you will be notified.` : `Someone bought this item at the Buy Now price of ${peso(a.winning_amount)}, so bidding ended at once. An administrator will confirm the result.`)
                  : (viewer?.is_leading ? "You had the highest bid. An administrator will confirm the result and you will be notified." : "An administrator will confirm the final result shortly.")}</p>
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

            {log.length > 0 && (
              <section aria-labelledby={`${titleId}-log`}>
                <h3 id={`${titleId}-log`} className="mb-2 flex items-center gap-2 font-[family-name:var(--font-heading)] text-[17px] font-semibold text-navy-800"><ListChecks size={16} className="text-gold-700" aria-hidden="true" /> Auction log</h3>
                <ol className="space-y-0 rounded-2xl border border-line px-4 py-3">
                  {[...log].reverse().map((event, index) => (
                    <li key={`${event.type}-${index}`} className="relative flex gap-3 pb-3 last:pb-0">
                      <span className="relative flex flex-col items-center" aria-hidden="true">
                        <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${event.type === "bid" ? "bg-gold-500" : event.type === "result" ? "bg-tide-500" : event.type === "buyout" ? "bg-gold-600" : event.type === "forfeited" ? "bg-rose-500" : "bg-iris-400"}`} />
                        {index < log.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
                      </span>
                      <span className="min-w-0 flex-1 text-[14px] leading-6 text-ink-soft">
                        {event.text}
                        {event.at && <span className="block text-[12.5px] text-ink-muted">{formatWhen(event.at)} · {timeAgo(event.at, now)}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

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
              <div className="space-y-2.5">
                <p className="flex items-center gap-2 text-[14.5px] font-semibold text-tide-700" role="status"><CheckCircle2 size={18} aria-hidden="true" /> You're the highest bidder at {peso(a.current_price)}.</p>
                {viewer.is_winner ? null : buyNowButton}
              </div>
            ) : open && signedIn && !verified ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2.5 text-[14.5px] text-ink-soft"><ShieldAlert size={18} className="shrink-0 text-gold-700" aria-hidden="true" /> Only verified accounts can bid. Upload an ID in your profile.</p>
                {onVerify && <button type="button" onClick={onVerify} className={`${CX.btnNavy} min-h-[44px] px-6`}>Verify my account</button>}
              </div>
            ) : open && signedIn ? (
              <div className="space-y-2.5">
                {buyNowButton}
                {buyNowOnly ? <p className="text-[12.5px] text-ink-muted">The next bid would reach the Buy Now price, so Buy Now is the only way to win now. Purchases are binding.</p> : (<>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick amounts">
                  {chips.map((chip) => (
                    <button key={chip} type="button" onClick={() => setAmount(String(chip))} className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold tabular-nums transition-colors ${Number(amount) === chip ? "border-gold-500 bg-gold-50 text-gold-800" : "border-line text-ink-soft hover:border-gold-400"}`}>{pesoShort(chip)}</button>
                  ))}
                </div>
                <div className="flex gap-2.5">
                  <label className="relative min-w-0 flex-1">
                    <span className="sr-only">Your bid in pesos</span>
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-semibold text-ink-muted" aria-hidden="true">₱</span>
                    <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); requestBid(); } }} className={`${CX.input} w-full pl-8 font-semibold tabular-nums`} />
                  </label>
                  <button type="button" onClick={requestBid} disabled={busy || !validAmount} className={`${CX.btnGold} min-h-[44px] shrink-0 px-5`}>Place bid</button>
                </div>
                <p className="text-[12.5px] text-ink-muted">Minimum {peso(minBid)}, then exact steps of {peso(a.bid_increment)} (such as {peso(minBid + a.bid_increment)}). Bids are binding.{buyout !== null && value >= buyout && validAmount ? ` A bid this high is a Buy Now: you pay ${peso(buyout)} and the auction ends.` : ""}</p>
                </>)}
              </div>
            ) : open ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[14.5px] text-ink-soft">Sign in with your UMak account to place a bid{buyout !== null ? ` or Buy Now for ${peso(buyout)}` : ""}.</p>
                {onSignIn && <button type="button" onClick={onSignIn} className={`${CX.btnGold} min-h-[44px] px-6`}>Log in to bid</button>}
              </div>
            ) : a.status === "scheduled" ? (
              <p className="text-[14.5px] text-ink-soft">Bidding opens {formatWhen(a.starts_at)}. Starting bid {peso(a.starting_price)}.</p>
            ) : a.status === "awaiting" ? (
              <p className="text-[14.5px] font-medium text-ink-soft">{a.bought_out ? "Bought with Buy Now. The result is waiting for an administrator." : "Bidding is closed. The result is waiting for an administrator."}</p>
            ) : (
              <p className="text-[14.5px] font-medium text-ink-soft">Bidding is closed.</p>
            )}
            {notice && <p role={notice.type === "error" ? "alert" : "status"} className={`mt-2 text-[13.5px] font-medium ${notice.type === "error" ? "text-rose-700" : "text-tide-700"}`}>{notice.text}</p>}
          </footer>
        </div>
      </div>
    </div>,
    document.body,
    )}

    <Modal
      open={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      dismissible={!busy}
      size="sm"
      tone="gold"
      icon={<Gavel size={21} />}
      eyebrow={isBuyNow ? "Confirm Buy Now" : "Confirm your bid"}
      title={isBuyNow ? `Buy this item now for ${peso(payAmount)}?` : `Bid ${peso(value)} on this item?`}
      description={isBuyNow ? "The auction ends at once and you are the winner. This cannot be undone." : "Bids are binding. You cannot take a bid back."}
      footer={<>
        <button type="button" onClick={() => { setConfirmOpen(false); setBuyNowChosen(false); }} disabled={busy} className={CX.btnGhost}>Cancel</button>
        <button type="button" onClick={() => void placeBid()} disabled={busy} data-autofocus className={isBuyNow ? CX.btnNavy : CX.btnGold}>{busy ? "Placing…" : isBuyNow ? `Buy Now ${pesoShort(payAmount)}` : `Confirm ${pesoShort(value)}`}</button>
      </>}
    >
      <div className="rounded-2xl border border-gold-200 bg-gold-50 px-4 py-3.5">
        <p className="text-[13px] font-medium text-ink-muted">{a.title}</p>
        <p className="mt-0.5 font-[family-name:var(--font-heading)] text-[28px] font-semibold tabular-nums text-navy-800">{peso(payAmount)}</p>
        <p className="text-[13px] text-ink-muted">{isBuyNow ? "Buy Now price. You never pay more than this." : a.bid_count === 0 ? "Opening bid" : `Current bid ${peso(a.current_price)}`}</p>
      </div>
      <ul className="mt-4 space-y-1.5 text-[14px] leading-6 text-ink-soft">
        <li>If you win, you pay and collect the item at the Lost and Found Office.</li>
        <li>Winners who do not collect can be suspended from E-Balik.</li>
        <li>{isBuyNow ? "Other bidders are told the auction ended. An administrator confirms your purchase." : "An administrator confirms the result after bidding closes."}</li>
      </ul>
    </Modal>
  </>);
}
