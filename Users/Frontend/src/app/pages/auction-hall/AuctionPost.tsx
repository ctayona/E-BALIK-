import { memo, useState } from "react";
import { Clock3, Gavel, Heart, MapPin, MessageCircle, TrendingUp, Zap } from "lucide-react";
import Gallery from "@/app/shared/auction/Gallery";
import QuickBid from "@/app/shared/auction/QuickBid";
import InlineComments from "@/app/shared/auction/InlineComments";
import { formatRemaining, msLeft, peso, useNow, type Auction } from "@/app/utils/auctions";

const ENDING_SOON_MS = 60 * 60 * 1000;

/** LIVE / ENDING SOON / ENDED, on the photo. Owns its own clock so only this ribbon re-renders each second. */
function Ribbon({ auction, offset }: { auction: Auction; offset: number }) {
  const left = msLeft(auction, useNow(), offset);
  const ended = auction.status !== "live" || left <= 0;
  const soon = !ended && left < ENDING_SOON_MS;
  const look = ended ? "bg-slate-700/90 text-white" : soon ? "bg-rose-600 text-white shadow-[0_8px_20px_-8px_rgba(225,29,72,0.9)]" : "bg-[linear-gradient(160deg,#f3dcab,#d1a153)] text-navy-950 shadow-[0_8px_20px_-8px_rgba(209,161,83,0.9)]";
  return (
    <span className={`pointer-events-none absolute left-3 top-3 z-[1] inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold tracking-[0.08em] ${look}`}>
      {!ended && <span className={`size-1.5 rounded-full ${soon ? "bg-white" : "bg-navy-950"} animate-pulse`} aria-hidden="true" />}
      {ended ? "ENDED" : soon ? "ENDING SOON" : "LIVE"}
    </span>
  );
}

/** The time left as a ticking counter, rose in the last five minutes. */
function Countdown({ auction, offset }: { auction: Auction; offset: number }) {
  const left = msLeft(auction, useNow(), offset);
  if (auction.status !== "live" || left <= 0) return <p className="text-[13px] font-semibold text-white/60">Bidding closed</p>;
  return (
    <p className={`flex items-center justify-end gap-1.5 text-[15px] font-semibold tabular-nums ${left < 5 * 60000 ? "text-rose-300" : "text-white"}`} role="timer" aria-label={`${formatRemaining(left)} left`}>
      <Clock3 size={15} className={left < 5 * 60000 ? "text-rose-300" : "text-gold-300"} aria-hidden="true" />{formatRemaining(left)}
    </p>
  );
}

/**
 * One lot in the Auction Hall: a high-contrast photo panel with the status ribbon and the heart, the current bid in large gold numerals,
 * the bid count and a ticking clock, then two tabs: bid right here, or read and add comments. Memoised: only its clocks tick.
 */
function AuctionPost({ auction, offset, watching, hearts, onToggleWatch, onOpen, onPlaced, onVerify }: {
  auction: Auction;
  offset: number;
  watching: boolean;
  hearts: number;
  onToggleWatch: (id: string) => void;
  onOpen: (auction: Auction, focus?: "comments") => void;
  onPlaced: () => void;
  onVerify?: () => void;
}) {
  const [panel, setPanel] = useState<"bid" | "comments">("bid");
  const noBids = auction.bid_count === 0;
  const photos = auction.gallery?.length ? auction.gallery : auction.image_url ? [auction.image_url] : [];
  const tabId = `lot-${auction.id}`;

  return (
    <article
      aria-label={auction.title}
      className="group relative flex flex-col overflow-hidden rounded-[26px] bg-[linear-gradient(180deg,#14224a_0%,#0b1430_100%)] text-white shadow-[0_30px_60px_-32px_rgba(5,10,30,0.95)] ring-1 ring-white/10 transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_0_0_1px_rgba(209,161,83,0.55),0_30px_70px_-28px_rgba(209,161,83,0.45)] motion-reduce:hover:translate-y-0"
    >
      <div className="relative">
        <Gallery images={photos} alt={auction.title} aspect="aspect-[4/3]" onOpen={() => onOpen(auction)} />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0b1430] to-transparent" aria-hidden="true" />
        <Ribbon auction={auction} offset={offset} />
        <button
          type="button"
          onClick={() => onToggleWatch(auction.id)}
          aria-pressed={watching}
          aria-label={watching ? `Stop watching ${auction.title}` : `Watch ${auction.title}`}
          className="absolute right-3 top-3 z-[1] flex h-10 items-center gap-1.5 rounded-full bg-[#0b1430]/60 px-3 text-white ring-1 ring-white/20 backdrop-blur-md transition-transform active:scale-90"
        >
          <Heart size={18} aria-hidden="true" fill={watching ? "#e11d48" : "none"} color={watching ? "#fb7185" : "currentColor"} />
          {hearts > 0 && <span className="text-[13px] font-semibold tabular-nums">{hearts}</span>}
        </button>
        <span className="pointer-events-none absolute bottom-3 left-4 z-[1] text-[12px] font-semibold tracking-[0.12em] text-gold-200/90">LOT {auction.reference || "—"}</span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <h3 className="font-[family-name:var(--font-heading)] text-[20px] font-semibold leading-snug tracking-[-0.01em]">{auction.title}</h3>
          <p className="mt-1 flex items-center gap-1.5 truncate text-[13px] text-white/60"><MapPin size={13} className="shrink-0" aria-hidden="true" />{[auction.location ? `Found at ${auction.location}` : "In UMak custody", auction.category].filter(Boolean).join(" · ")}</p>
        </div>

        <div className="flex items-end justify-between gap-3 border-y border-white/10 py-3.5">
          <div className="min-w-0">
            <p className="text-[12px] font-medium tracking-wide text-white/55">{noBids ? "Starting bid" : "Highest bid"}</p>
            <p className="text-gradient-gold font-[family-name:var(--font-heading)] text-[34px] font-semibold leading-none tabular-nums">{peso(auction.current_price)}</p>
            {auction.leader && <p className="mt-1.5 truncate text-[12.5px] text-white/60">by <span className="font-semibold text-white/85">{auction.my_state === "leading" ? "you" : auction.leader}</span></p>}
          </div>
          <div className="shrink-0 text-right">
            <Countdown auction={auction} offset={offset} />
            <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] tabular-nums text-white/60"><TrendingUp size={14} aria-hidden="true" />{noBids ? "No bids yet" : `${auction.bid_count} ${auction.bid_count === 1 ? "bid" : "bids"}`}</p>
          </div>
        </div>

        {auction.my_state === "outbid" && <p className="-mt-1 rounded-xl bg-rose-500/15 px-3 py-2 text-[13px] font-semibold text-rose-200 ring-1 ring-rose-300/30">You were outbid. Bid again to take the lead.</p>}

        <div role="tablist" aria-label={`${auction.title}: bid or comments`} className="grid grid-cols-2 gap-1 rounded-2xl bg-white/[0.06] p-1 ring-1 ring-white/10">
          {([["bid", "Place bid", Gavel], ["comments", "Comments", MessageCircle]] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`${tabId}-${value}`}
              aria-selected={panel === value}
              aria-controls={`${tabId}-${value}-panel`}
              onClick={() => setPanel(value)}
              className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl text-[13.5px] font-semibold transition-colors ${panel === value ? "bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" : "text-white/60 hover:text-white"}`}
            >
              <Icon size={15} aria-hidden="true" />{label}
            </button>
          ))}
        </div>

        <div id={`${tabId}-${panel}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${panel}`}>
          {panel === "bid"
            ? <QuickBid auction={auction} onPlaced={onPlaced} onOpen={() => onOpen(auction)} onVerify={onVerify} />
            : <InlineComments auctionId={auction.id} onOpenAll={() => onOpen(auction, "comments")} />}
        </div>

        <button type="button" onClick={() => onOpen(auction)} className="mt-auto inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl text-[13.5px] font-semibold text-gold-300 transition-colors hover:bg-white/[0.06] hover:text-gold-200">
          {auction.buyout_price != null && !auction.bought_out && <Zap size={14} fill="currentColor" aria-hidden="true" />}View lot details, bids and photos
        </button>
      </div>
    </article>
  );
}

export default memo(AuctionPost);
