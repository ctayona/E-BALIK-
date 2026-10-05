import { Gavel, MapPin } from "lucide-react";
import { formatRemaining, formatWhen, msLeft, pesoShort, type Auction } from "@/app/utils/auctions";

/** Small building blocks shared by the Auction Hall, the dashboard panel and the landing showcase. */

export function AuctionClock({ auction, now, offset, className = "" }: { auction: Auction; now: number; offset: number; className?: string }) {
  const left = msLeft(auction, now, offset);
  const base = `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold tabular-nums ${className}`;
  if (auction.status === "live" && left > 0) {
    const urgent = left < 5 * 60000;
    return (
      <span className={`${base} ${urgent ? "bg-rose-600 text-white" : "bg-navy-950/75 text-gold-200 backdrop-blur"}`} role="timer" aria-label={`${formatRemaining(left)} left`}>
        <span className={`size-1.5 rounded-full ${urgent ? "animate-pulse bg-white" : "bg-gold-400"}`} aria-hidden="true" />{formatRemaining(left)} left
      </span>
    );
  }
  if (auction.status === "scheduled") {
    const opens = Date.parse(auction.starts_at) - (now + offset);
    return <span className={`${base} bg-iris-600 text-white`}>{opens > 0 ? `Opens in ${formatRemaining(opens)}` : "Opening"}</span>;
  }
  if (auction.status === "cancelled") return <span className={`${base} bg-rose-600 text-white`}>Cancelled</span>;
  return <span className={`${base} bg-navy-950/75 text-white backdrop-blur`}>{auction.status === "live" ? "Closing" : "Ended"}</span>;
}

/** Compact auction card: photo, closing clock, price and bid count. */
export function AuctionTile({ auction, now, offset, onOpen, tone = "surface" }: {
  auction: Auction;
  now: number;
  offset: number;
  onOpen: (auction: Auction) => void;
  tone?: "surface" | "night";
}) {
  const night = tone === "night";
  return (
    <button
      type="button"
      onClick={() => onOpen(auction)}
      className={`group flex h-full w-full flex-col overflow-hidden rounded-[20px] border text-left transition-[transform,box-shadow] duration-300 hover:-translate-y-1 ${night ? "border-white/10 bg-white/[0.06] text-white hover:shadow-[0_24px_50px_-24px_rgba(0,0,0,0.8)]" : "border-white/80 bg-white/90 shadow-card hover:shadow-raised"}`}
      aria-label={`${auction.title}, current bid ${pesoShort(auction.current_price)}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-navy-900">
        {auction.image_url ? (
          <img src={auction.image_url} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        ) : (
          <div className="flex size-full items-center justify-center bg-[radial-gradient(120%_90%_at_20%_0%,#33497f_0%,#1f3160_45%,#0e1830_100%)] text-gold-300"><Gavel size={30} aria-hidden="true" /></div>
        )}
        <AuctionClock auction={auction} now={now} offset={offset} className="absolute left-3 top-3" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className={`line-clamp-1 font-[family-name:var(--font-heading)] text-[16.5px] font-semibold ${night ? "text-white" : "text-navy-800"}`}>{auction.title}</h3>
        <p className={`flex items-center gap-1.5 truncate text-[13px] ${night ? "text-white/60" : "text-ink-muted"}`}>
          <MapPin size={13} aria-hidden="true" className="shrink-0" /> {[auction.location, auction.category].filter(Boolean).join(" · ") || "UMak Lost and Found"}
        </p>
        <div className={`mt-auto flex items-end justify-between gap-3 border-t pt-3 ${night ? "border-white/10" : "border-line"}`}>
          <div>
            <p className={`text-[12px] font-medium ${night ? "text-white/55" : "text-ink-muted"}`}>{auction.bid_count === 0 ? "Starting bid" : "Current bid"}</p>
            <p className={`font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-none tabular-nums ${night ? "text-gold-300" : "text-navy-800"}`}>{pesoShort(auction.current_price)}</p>
          </div>
          <p className={`text-[12.5px] font-medium tabular-nums ${night ? "text-white/65" : "text-ink-muted"}`}>{auction.bid_count === 0 ? "No bids yet" : `${auction.bid_count} ${auction.bid_count === 1 ? "bid" : "bids"}`}</p>
        </div>
      </div>
    </button>
  );
}

/** Past auction tile with the hatched SOLD overlay. */
export function SoldTile({ auction, onOpen }: { auction: Auction; onOpen: (auction: Auction) => void }) {
  return (
    <button type="button" onClick={() => onOpen(auction)} aria-label={`${auction.title}, ${auction.sold ? `sold for ${pesoShort(auction.winning_amount)}` : "ended without bids"}`} className="group relative aspect-square overflow-hidden rounded-[18px] bg-navy-900 text-left outline-offset-2">
      {auction.image_url && <img src={auction.image_url} alt="" loading="lazy" className="size-full object-cover opacity-60 grayscale-[35%] transition-opacity group-hover:opacity-80" />}
      <span className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(14,24,48,0.55)_0,rgba(14,24,48,0.55)_6px,rgba(14,24,48,0.2)_6px,rgba(14,24,48,0.2)_12px)]" aria-hidden="true" />
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
        <span className="font-[family-name:var(--font-heading)] text-[24px] font-bold text-white drop-shadow sm:text-[28px]">{auction.sold ? "SOLD" : "ENDED"}</span>
        {auction.sold && <span className="rounded-full bg-gold-500 px-2.5 py-0.5 text-[12.5px] font-bold tabular-nums text-navy-950">{pesoShort(auction.winning_amount)}</span>}
      </span>
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950/90 to-transparent p-3 pt-8">
        <span className="line-clamp-1 block text-[13px] font-semibold text-white">{auction.title}</span>
        <span className="block text-[11.5px] text-white/65">{formatWhen(auction.ends_at)}</span>
      </span>
    </button>
  );
}
