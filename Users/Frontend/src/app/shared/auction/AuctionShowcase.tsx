import { useCallback, useMemo, useState } from "react";
import { Gavel, Clock3, ShieldCheck, Trophy } from "lucide-react";
import { AuctionTile, SoldTile } from "@/app/shared/auction/AuctionParts";
import AuctionDetail from "@/app/shared/auction/AuctionDetail";
import { msLeft, useAuctionFeed, useNow, type Auction } from "@/app/utils/auctions";

/** Landing-page showcase: live lots for signed-out visitors, or recent sales when nothing is live. Hidden until there is something to show. */
export default function AuctionShowcase({ onLogin }: { onLogin: () => void }) {
  const { feed, setupRequired, loading, offset, refresh } = useAuctionFeed(30000);
  const now = useNow();
  const [open, setOpen] = useState<Auction | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const live = useMemo(
    () => (feed?.live ?? []).filter((a) => a.status === "live" && msLeft(a, now, offset) > 0).sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at)),
    [feed, now, offset],
  );
  const sold = useMemo(() => (feed?.past ?? []).filter((a) => a.sold).slice(0, 4), [feed]);

  if (setupRequired || loading || (live.length === 0 && sold.length === 0)) return null;
  const showingLive = live.length > 0;

  return (
    <section className="relative overflow-hidden bg-[#162448] px-8 py-20 md:px-16" aria-labelledby="landing-auctions">
      <div className="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full opacity-25" style={{ background: "radial-gradient(circle, #d1a153 0%, transparent 70%)" }} aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 size-[360px] rounded-full opacity-20" style={{ background: "radial-gradient(circle, #4a7adf 0%, transparent 70%)" }} aria-hidden="true" />
      <div className="relative mx-auto flex w-full max-w-[1140px] flex-col gap-10">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[560px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-[13px] font-semibold text-gold-300"><Gavel size={13} aria-hidden="true" /> Auction Hall</span>
            <h2 id="landing-auctions" className="mt-4 text-[32px] font-semibold leading-tight text-white md:text-[40px]" style={{ fontFamily: "var(--font-heading)" }}>
              {showingLive ? "Unclaimed items, a second chance." : "Recently sold in the Auction Hall."}
            </h2>
            <p className="mt-3 text-[16px] leading-7 text-white/65">
              {showingLive ? "Items nobody claimed within a month go up for bidding. Browse the lots below, then log in with your UMak account to bid." : "Items nobody claimed within a month are auctioned to the campus community. New lots appear here."}
            </p>
          </div>
          <button type="button" onClick={onLogin} className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-[14px] border border-gold-600/40 bg-[linear-gradient(180deg,#e6be76_0%,#d1a153_100%)] px-7 text-[15px] font-bold text-navy-950 shadow-[0_1px_0_rgba(255,255,255,0.45)_inset] transition hover:shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,var(--shadow-glow-gold)]">
            {showingLive ? "Log in to bid" : "Log in to see auctions"}
          </button>
        </div>

        {showingLive ? (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {live.slice(0, 4).map((auction) => <li key={auction.id}><AuctionTile auction={auction} now={now} offset={offset} onOpen={setOpen} tone="night" /></li>)}
          </ul>
        ) : (
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {sold.map((auction) => <li key={auction.id}><SoldTile auction={auction} onOpen={setOpen} /></li>)}
          </ul>
        )}

        <ul className="grid gap-4 border-t border-white/10 pt-8 text-[14px] text-white/70 sm:grid-cols-3">
          <li className="flex items-start gap-3"><Clock3 size={18} className="mt-0.5 shrink-0 text-gold-300" aria-hidden="true" /> Anti-snipe timers extend the clock when a bid lands in the final minutes.</li>
          <li className="flex items-start gap-3"><Trophy size={18} className="mt-0.5 shrink-0 text-gold-300" aria-hidden="true" /> The highest bid wins and is notified in the app and by email.</li>
          <li className="flex items-start gap-3"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-gold-300" aria-hidden="true" /> Pay and collect in person at the Lost and Found Office with your ID.</li>
        </ul>
      </div>

      {open && <AuctionDetail auction={open} signedIn={false} onClose={close} onChanged={() => void refresh()} onSignIn={() => { setOpen(null); onLogin(); }} />}
    </section>
  );
}
