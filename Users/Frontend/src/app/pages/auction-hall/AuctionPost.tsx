import { BadgeCheck, Heart, MapPin, MessageCircle, TrendingUp } from "lucide-react";
import headerUmSeal from "@/imports/Header/9aefa1789ba406d6291f8aa816f84df70a02953b.webp";
import Gallery from "@/app/shared/auction/Gallery";
import { AuctionClock } from "@/app/shared/auction/AuctionParts";
import { formatRemaining, msLeft, peso, type Auction } from "@/app/utils/auctions";
import { CX } from "@/app/utils/clay";

/** One auction as a feed post: header, swipeable photos, quick actions, price bar. */
export default function AuctionPost({ auction, now, offset, watching, onToggleWatch, onOpen }: {
  auction: Auction;
  now: number;
  offset: number;
  watching: boolean;
  onToggleWatch: (id: string) => void;
  onOpen: (auction: Auction, focus?: "comments") => void;
}) {
  const left = msLeft(auction, now, offset);
  const urgent = auction.status === "live" && left > 0 && left < 5 * 60000;
  const noBids = auction.bid_count === 0;

  return (
    <article className={`${CX.card} overflow-hidden`} aria-label={auction.title}>
      <header className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-navy-800 ring-2 ring-gold-400/40"><img decoding="async" src={headerUmSeal} alt="" className="size-7 object-contain" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[14.5px] font-semibold text-navy-800">UMak Lost &amp; Found <BadgeCheck size={15} className="text-iris-600" aria-label="Official" /></p>
          <p className="truncate text-[12.5px] text-ink-muted">Lot {auction.reference || "—"}{auction.category ? ` · ${auction.category}` : ""}</p>
        </div>
        <AuctionClock auction={auction} now={now} offset={offset} className="shrink-0" />
      </header>

      <Gallery images={auction.gallery} alt={auction.title} aspect="aspect-[4/3] sm:aspect-[16/11]" onOpen={() => onOpen(auction)} />

      <div className="flex items-center gap-1 px-3 pt-2.5">
        <button type="button" onClick={() => onToggleWatch(auction.id)} aria-pressed={watching} aria-label={watching ? `Stop watching ${auction.title}` : `Watch ${auction.title}`} className="flex size-11 items-center justify-center rounded-full text-navy-800 transition-colors hover:bg-navy-50">
          <Heart size={23} aria-hidden="true" fill={watching ? "#e11d48" : "none"} color={watching ? "#e11d48" : "currentColor"} />
        </button>
        <button type="button" onClick={() => onOpen(auction, "comments")} aria-label={`Comments on ${auction.title}`} className="flex size-11 items-center justify-center rounded-full text-navy-800 transition-colors hover:bg-navy-50">
          <MessageCircle size={22} aria-hidden="true" />
        </button>
        <span className="ml-auto flex items-center gap-1.5 pr-2 text-[13px] font-medium tabular-nums text-ink-muted"><TrendingUp size={15} aria-hidden="true" /> {noBids ? "No bids yet" : `${auction.bid_count} ${auction.bid_count === 1 ? "bid" : "bids"}`}</span>
      </div>

      <div className="space-y-1.5 px-4 pb-4 pt-1">
        <h3 className="font-[family-name:var(--font-heading)] text-[21px] font-semibold leading-snug text-navy-800">{auction.title}</h3>
        <p className="flex items-center gap-1.5 text-[13.5px] text-ink-muted"><MapPin size={13} aria-hidden="true" /> {auction.location ? `Found at ${auction.location}` : "In UMak custody"}</p>
        {auction.leader && auction.status === "live" && <p className="text-[13.5px] text-ink-soft">Leading: <span className="font-semibold text-navy-800">{auction.leader}</span></p>}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-frost-50/70 px-4 py-3.5">
        <div className="mr-auto">
          <p className="text-[12.5px] font-medium text-ink-muted">{noBids ? "Starting bid" : "Current bid"}</p>
          <p className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-none tabular-nums text-navy-800">{peso(auction.current_price)}</p>
          {auction.status === "live" && left > 0 && <p className={`mt-1 text-[12.5px] font-medium tabular-nums ${urgent ? "text-rose-600" : "text-ink-muted"}`}>Closes in {formatRemaining(left)}</p>}
        </div>
        <button type="button" onClick={() => onOpen(auction)} className={`${CX.btnGhost} min-h-[44px] px-5`}>Details</button>
        {auction.status === "live" && left > 0 && <button type="button" onClick={() => onOpen(auction)} className={`${CX.btnGold} min-h-[44px] px-6`}>Place bid</button>}
      </footer>
    </article>
  );
}
