import { memo } from "react";
import { BadgeCheck, Clock3, Heart, MapPin, MessageCircle, Share2, Tag, TrendingUp, Zap } from "lucide-react";
import headerUmSeal from "@/imports/Header/9aefa1789ba406d6291f8aa816f84df70a02953b.webp";
import Gallery from "@/app/shared/auction/Gallery";
import { AuctionClock } from "@/app/shared/auction/AuctionParts";
import { peso, type Auction } from "@/app/utils/auctions";
import { shareAuction } from "@/app/utils/shareReport";
import { timeAgo } from "./time";
import { FEED_CARD } from "./feedStyle";
import { ACTION, ACTION_IDLE, Chip, CountBadge, PrimaryAction } from "./postParts";

/**
 * One live auction as a post in the home feed, in the same layout as a report post: who posted (the Auction Hall), when, what it is, the
 * photos with the closing clock on them, the current bid, then Watch (the heart), Comment and Share, and the step that fits: bid, or bid again.
 * Bidding, the bid list and the comments open in the auction's own window (`onOpen`); this card only shows the state. Memoised: only the clock ticks.
 */
function AuctionFeedCard({ auction, offset, watching, hearts, onToggleWatch, onOpen }: {
  auction: Auction;
  offset: number;
  watching: boolean;
  hearts: number;
  onToggleWatch: (id: string) => void;
  onOpen: (auction: Auction, focus?: "comments") => void;
}) {
  const noBids = auction.bid_count === 0;
  const photos = auction.gallery?.length ? auction.gallery : auction.image_url ? [auction.image_url] : [];
  const primary =
    auction.my_state === "leading" ? { label: "You're leading", hint: "View your bid", gold: false }
    : auction.my_state === "outbid" ? { label: "You were outbid", hint: `Bid ${peso(auction.min_next_bid)} or more`, gold: true }
    : { label: "Place a bid", hint: `from ${peso(auction.min_next_bid)}`, gold: true };

  return (
    <article aria-label={`Auction: ${auction.title}`} className={`${FEED_CARD} overflow-hidden`}>
      <header className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(160deg,#33497f_0%,#1f3160_60%,#162448_100%)] shadow-[0_6px_16px_-8px_rgba(31,49,96,0.7)] ring-2 ring-white" aria-hidden="true">
          <img decoding="async" src={headerUmSeal} alt="" className="size-8 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 whitespace-nowrap text-[15px] font-semibold leading-5 text-ink">
            Auction Hall <BadgeCheck size={16} className="shrink-0 text-iris-600" aria-label="Official" />
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] leading-5 text-ink-muted">
            <Clock3 size={12} className="shrink-0" aria-hidden="true" />
            <time className="shrink-0" dateTime={auction.starts_at}>{timeAgo(auction.starts_at)}</time>
            <span aria-hidden="true">·</span>
            <span className="truncate">Lot {auction.reference || "—"}</span>
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold-50 px-2.5 py-1 text-[12px] font-semibold text-gold-800 ring-1 ring-gold-200">
          <span className="size-1.5 animate-pulse rounded-full bg-gold-500" aria-hidden="true" />Live auction
        </span>
      </header>

      <div className="px-4 pb-3 pt-3.5 sm:px-5">
        <h3 className="font-[family-name:var(--font-heading)] text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">{auction.title}</h3>
        {auction.description && <p className="mt-1.5 line-clamp-3 whitespace-pre-line break-words text-[15px] leading-6 text-ink-soft">{auction.description}</p>}
        <ul className="mt-3 flex flex-wrap gap-1.5 text-[12.5px] text-ink-soft">
          <Chip icon={<MapPin size={13} className="text-gold-700" aria-hidden="true" />}>{auction.location ? `Found at ${auction.location}` : "In UMak custody"}</Chip>
          {auction.category && <Chip icon={<Tag size={13} className="text-gold-700" aria-hidden="true" />}>{auction.category}</Chip>}
          {auction.buyout_price != null && <Chip icon={<Zap size={13} fill="currentColor" className="text-gold-700" aria-hidden="true" />}>Buy Now {peso(auction.buyout_price)}</Chip>}
        </ul>
      </div>

      <div className="relative">
        <Gallery images={photos} alt={auction.title} aspect="aspect-[16/10]" className="max-h-[460px]" onOpen={() => onOpen(auction)} />
        <AuctionClock auction={auction} offset={offset} className="pointer-events-none absolute left-3 top-3" />
      </div>

      <div className="mx-4 mt-3 flex items-end justify-between gap-3 rounded-2xl bg-gradient-to-br from-gold-50 to-frost-50 p-3.5 ring-1 ring-gold-200/70 sm:mx-5">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-ink-muted">{noBids ? "Starting bid" : "Current bid"}</p>
          <p className="font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-none tabular-nums text-navy-800">{peso(auction.current_price)}</p>
          {auction.leader && <p className="mt-1.5 truncate text-[12.5px] text-ink-soft">Leading: <span className="font-semibold text-navy-800">{auction.leader}</span></p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold tabular-nums text-ink-soft"><TrendingUp size={14} aria-hidden="true" />{noBids ? "No bids yet" : `${auction.bid_count} ${auction.bid_count === 1 ? "bid" : "bids"}`}</p>
          <p className="mt-1 text-[12.5px] tabular-nums text-ink-muted">Next bid {peso(auction.min_next_bid)}</p>
        </div>
      </div>

      <div className="mx-4 mt-1 sm:mx-5">
        <div className="grid grid-cols-3 gap-1 border-b border-line/70 py-1.5">
          <button
            type="button"
            onClick={() => onToggleWatch(auction.id)}
            aria-pressed={watching}
            aria-label={watching ? `Stop watching ${auction.title}` : `Watch ${auction.title}`}
            className={`${ACTION} ${watching ? "bg-rose-50 text-rose-700 shadow-[0_0_0_1px_rgba(225,29,72,0.35),0_8px_24px_-8px_rgba(225,29,72,0.5)]" : ACTION_IDLE}`}
          >
            <span className="relative flex">
              <Heart size={18} fill={watching ? "currentColor" : "none"} aria-hidden="true" />
              {hearts > 0 && <CountBadge value={hearts} label={hearts === 1 ? "heart" : "hearts"} />}
            </span>
            Watch
          </button>
          <button type="button" onClick={() => onOpen(auction, "comments")} className={`${ACTION} ${ACTION_IDLE}`}>
            <MessageCircle size={18} aria-hidden="true" />Comment
          </button>
          <button type="button" onClick={() => void shareAuction(auction.id)} className={`${ACTION} ${ACTION_IDLE}`} title="Copy a link to this auction">
            <Share2 size={18} aria-hidden="true" />Share
          </button>
        </div>
        <PrimaryAction label={primary.label} hint={primary.hint} gold={primary.gold} onClick={() => onOpen(auction)} />
      </div>
    </article>
  );
}

export default memo(AuctionFeedCard);
