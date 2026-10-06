import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Gavel } from "lucide-react";
import { AuctionTile } from "@/app/shared/auction/AuctionParts";
import AuctionDetail from "@/app/shared/auction/AuctionDetail";
import { SkeletonBlock } from "@/app/shared/LoadingSkeleton";
import { CX } from "@/app/utils/clay";
import { msLeft, useAuctionFeed, useClosingTick, type Auction } from "@/app/utils/auctions";

/** Dashboard panel: the live auctions closing soonest, with bidding available right from the tile. */
export default function AuctionShelf({ onViewAll, onVerify }: { onViewAll: () => void; onVerify?: () => void }) {
  const { feed, setupRequired, loading, offset, refresh } = useAuctionFeed(30000);
  const closingTick = useClosingTick(feed?.live ?? [], offset);
  const [open, setOpen] = useState<Auction | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const live = useMemo(
    () => (feed?.live ?? []).filter((a) => a.status === "live" && msLeft(a, Date.now(), offset) > 0).sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closingTick re-runs this right after an auction closes
    [feed, offset, closingTick],
  );

  if (setupRequired) return null;

  return (
    <section aria-labelledby="dashboard-auctions">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gold-50 text-gold-700 ring-1 ring-gold-200"><Gavel size={18} aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className={CX.eyebrow}>Auction Hall</p>
            <h2 id="dashboard-auctions" className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-[20px] font-semibold tracking-[-0.01em] text-ink sm:text-[22px]">
              Live auctions
              <span className="rounded-full bg-white/80 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-ink-muted ring-1 ring-line">{loading ? "…" : live.length}</span>
            </h2>
          </div>
        </div>
        <button type="button" onClick={onViewAll} className="hidden h-11 items-center gap-1 rounded-xl px-3 text-[14px] font-semibold text-iris-700 hover:bg-iris-50 sm:inline-flex">
          View all <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} className="h-[300px] w-full rounded-[20px]" />)}</div>
      ) : live.length === 0 ? (
        <button type="button" onClick={onViewAll} className="glass flex w-full items-center gap-4 rounded-[22px] px-5 py-5 text-left transition hover:shadow-raised">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-frost-100 text-gold-700"><Gavel size={22} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">No live auctions right now</span>
            <span className="block text-[13.5px] text-ink-muted">Items unclaimed for a month are auctioned here. See what sold recently.</span>
          </span>
          <ArrowRight size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
        </button>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {live.slice(0, 4).map((auction) => (
            <li key={auction.id}><AuctionTile auction={auction} offset={offset} onOpen={setOpen} /></li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onViewAll} className={`${CX.btnGhost} mt-4 w-full sm:hidden`}>View all auctions <ArrowRight size={15} aria-hidden="true" /></button>

      {open && <AuctionDetail auction={open} signedIn onClose={close} onChanged={() => void refresh()} onVerify={onVerify ? () => { close(); onVerify(); } : undefined} />}
    </section>
  );
}
