import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { BellRing, Clock3, Gavel, Heart, ListChecks, Search, ShieldCheck, Sparkles, Store, Trophy } from "lucide-react";
import { AuctionClock, AuctionTile, SoldTile } from "@/app/shared/auction/AuctionParts";
import { useWatchlist } from "@/app/shared/auction/useWatchlist";
import { auctionsApi, formatRemaining, msLeft, pesoShort, useAuctionFeed, useClosingTick, useNow, type Auction } from "@/app/utils/auctions";
import { authUtils } from "@/app/utils/api";
import { CX } from "@/app/utils/clay";
import type { Page } from "@/app/types";
import AuctionDetail from "@/app/shared/auction/AuctionDetail";
import AuctionPost from "./AuctionPost";
import SellingPanel from "./SellingPanel";

type Tab = "live" | "upcoming" | "sold" | "mine" | "selling";
type Sort = "ending" | "price" | "bids";

const SORTS: { value: Sort; label: string }[] = [
  { value: "ending", label: "Ending soonest" },
  { value: "price", label: "Highest bid" },
  { value: "bids", label: "Most bids" },
];

const MY_STATE_LABEL: Record<NonNullable<Auction["my_state"]>, { text: string; className: string }> = {
  leading: { text: "You're leading", className: "bg-tide-600 text-white" },
  outbid: { text: "Outbid", className: "bg-rose-600 text-white" },
  won: { text: "You won", className: "bg-gold-500 text-navy-950" },
  awaiting: { text: "Awaiting result", className: "bg-iris-600 text-white" },
  lost: { text: "Not won", className: "bg-slate-600 text-white" },
  cancelled: { text: "Cancelled", className: "bg-slate-600 text-white" },
};

/** The empty Live tab: a quiet gavel on gold rings, and where to look instead. */
function EmptyHall({ onResults, hasUpcoming, onUpcoming }: { onResults: () => void; hasUpcoming: boolean; onUpcoming: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,#14224a_0%,#0b1430_100%)] px-6 py-12 text-center text-white ring-1 ring-white/10">
      <span className="pointer-events-none absolute left-1/2 top-10 size-64 -translate-x-1/2 rounded-full bg-gold-500/15 blur-3xl" aria-hidden="true" />
      <svg viewBox="0 0 160 120" className="relative mx-auto h-[120px] w-auto" role="img" aria-label="A gavel resting on its block">
        <defs><linearGradient id="hall-gold" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#f3dcab" /><stop offset="1" stopColor="#b9873a" /></linearGradient></defs>
        <circle cx="80" cy="60" r="54" fill="none" stroke="#d1a153" strokeOpacity="0.35" strokeWidth="1.5" />
        <circle cx="80" cy="60" r="40" fill="none" stroke="#d1a153" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="4 6" />
        <rect x="46" y="86" width="68" height="12" rx="4" fill="url(#hall-gold)" />
        <rect x="56" y="80" width="48" height="8" rx="3" fill="#d1a153" fillOpacity="0.7" />
        <g transform="rotate(-35 80 50)">
          <rect x="62" y="30" width="36" height="18" rx="5" fill="url(#hall-gold)" />
          <rect x="77" y="46" width="6" height="40" rx="3" fill="#f3dcab" />
        </g>
      </svg>
      <h2 className="relative mt-5 font-[family-name:var(--font-heading)] text-[24px] font-semibold tracking-[-0.01em]">No lots on the block right now</h2>
      <p className="relative mx-auto mt-2 max-w-[44ch] text-[14.5px] leading-6 text-white/65">Items nobody claims within a month are auctioned here. New lots appear on this page, and the ones you watch notify you.</p>
      <div className="relative mt-6 flex flex-wrap justify-center gap-2">
        {hasUpcoming && <button type="button" onClick={onUpcoming} className={`${CX.btnGold} min-h-[46px] px-6`}>See upcoming lots</button>}
        <button type="button" onClick={onResults} className="inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-white/10 px-6 text-[14.5px] font-semibold text-white ring-1 ring-white/20 hover:bg-white/15">See past results</button>
      </div>
    </div>
  );
}

/** "Next auction closes in ..." line. Owns its own clock so the whole hall does not re-render every second. */
function NextClose({ auction, offset }: { auction?: Auction; offset: number }) {
  const left = msLeft(auction ?? { ends_at: "" }, useNow(), offset);
  return <>{auction && left > 0 ? `Next auction closes in ${formatRemaining(left)}` : "New auctions are announced here."}</>;
}

function monthLabel(value: string) {
  return new Date(value).toLocaleString([], { month: "long", year: "numeric" });
}

export default function AuctionHall({ onNavigate, initialTab }: { onNavigate?: (page: Page) => void; initialTab?: "selling" }) {
  const { feed, error, setupRequired, loading, offset, refresh } = useAuctionFeed();
  const closingTick = useClosingTick(feed?.live ?? [], offset);
  const watch = useWatchlist();
  const signedIn = Boolean(authUtils.getToken());
  const [tab, setTab] = useState<Tab>(initialTab && authUtils.getToken() ? initialTab : "live");
  const [sort, setSort] = useState<Sort>("ending");
  const [search, setSearch] = useState("");
  const [onlyWatched, setOnlyWatched] = useState(false);
  const [open, setOpen] = useState<{ auction: Auction; focus?: "comments" } | null>(null);
  const [mine, setMine] = useState<Auction[] | null>(null);
  const [mineError, setMineError] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());

  const loadMine = useCallback(async () => {
    if (!signedIn) return;
    try {
      const data = await auctionsApi.mine();
      setMine(data.auctions);
      setMineError("");
    } catch (reason) {
      setMineError(reason instanceof Error ? reason.message : "Unable to load your bids.");
    }
  }, [signedIn]);

  useEffect(() => { if (tab === "mine") void loadMine(); }, [tab, loadMine]);

  const matches = useCallback((a: Auction) => (!query || `${a.title} ${a.reference} ${a.category} ${a.location}`.toLowerCase().includes(query)) && (!onlyWatched || watch.watching(a.id)), [query, onlyWatched, watch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- closingTick re-runs this right after an auction closes
  const liveAll = useMemo(() => (feed?.live ?? []).filter((a) => a.status === "live" && msLeft(a, Date.now(), offset) > 0), [feed, offset, closingTick]);
  const upcomingAll = useMemo(() => (feed?.live ?? []).filter((a) => a.status === "scheduled"), [feed]);
  const live = useMemo(() => {
    const list = liveAll.filter(matches);
    return [...list].sort((a, b) => sort === "price" ? b.current_price - a.current_price : sort === "bids" ? b.bid_count - a.bid_count : Date.parse(a.ends_at) - Date.parse(b.ends_at));
  }, [liveAll, matches, sort]);
  const upcoming = useMemo(() => upcomingAll.filter(matches).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)), [upcomingAll, matches]);
  const sold = useMemo(() => (feed?.past ?? []).filter(matches), [feed, matches]);
  const soldGroups = useMemo(() => {
    const groups = new Map<string, Auction[]>();
    sold.forEach((a) => { const key = monthLabel(a.ends_at); groups.set(key, [...(groups.get(key) ?? []), a]); });
    return [...groups.entries()];
  }, [sold]);
  const endingSoon = useMemo(() => [...liveAll].sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at)).slice(0, 3), [liveAll]);

  const openAuction = useCallback((auction: Auction, focus?: "comments") => setOpen({ auction, focus }), []);
  const closeAuction = useCallback(() => setOpen(null), []);
  const changed = useCallback(() => { void refresh(); if (tab === "mine") void loadMine(); }, [refresh, loadMine, tab]);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "live", label: "Live", count: liveAll.length },
    { id: "upcoming", label: "Upcoming", count: upcomingAll.length },
    { id: "sold", label: "Results", count: feed?.past.length ?? 0 },
    ...(signedIn ? [{ id: "mine" as Tab, label: "My bids" }, { id: "selling" as Tab, label: "Selling" }] : []),
  ];
  const openById = useCallback((id: string) => {
    const found = [...(feed?.live ?? []), ...(feed?.past ?? [])].find((a) => a.id === id);
    if (found) openAuction(found);
  }, [feed, openAuction]);

  return (
    <main className={CX.page}>
      <div className={CX.inner}>
        <section className="relative isolate overflow-hidden rounded-[30px] bg-[linear-gradient(135deg,#0e1830_0%,#162448_50%,#1f3160_100%)] p-6 text-white shadow-[0_40px_80px_-40px_rgba(5,10,30,0.9)] ring-1 ring-white/10 sm:p-8 lg:p-10" aria-labelledby="auction-hero">
          <span className="pointer-events-none absolute -right-20 -top-28 -z-10 size-[420px] rounded-full bg-[radial-gradient(circle,rgba(209,161,83,0.45),transparent_65%)] blur-2xl animate-[pulse_6s_ease-in-out_infinite] motion-reduce:animate-none" aria-hidden="true" />
          <span className="pointer-events-none absolute -bottom-32 -left-16 -z-10 size-[360px] rounded-full bg-[radial-gradient(circle,rgba(110,142,240,0.25),transparent_65%)] blur-2xl" aria-hidden="true" />
          <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.9),transparent)]" aria-hidden="true" />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-[13px] font-semibold text-gold-300"><Gavel size={13} aria-hidden="true" /> University of Makati · Lost &amp; Found</span>
              <h1 id="auction-hero" className="mt-4 text-[34px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[44px]" style={{ fontFamily: "var(--font-heading)" }}>
                <span className="text-gradient-gold">Auction Hall</span>
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-white/70">Items nobody claimed within a month go up for bidding, alongside items UMak members list themselves. The office checks every lot and hands it over in person.</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-md">
              <div><dt className="text-[12.5px] font-medium text-white/55">Live now</dt><dd className="mt-1 flex items-center gap-2 text-3xl font-semibold tabular-nums text-gold-300">{liveAll.length > 0 && <span className="size-2 animate-pulse rounded-full bg-gold-400" aria-hidden="true" />}{liveAll.length}</dd></div>
              <div><dt className="text-[12.5px] font-medium text-white/55">Sold so far</dt><dd className="mt-1 text-3xl font-semibold tabular-nums text-white">{(feed?.past ?? []).filter((a) => a.sold).length}</dd></div>
              <div className="col-span-2 flex items-center gap-2 border-t border-white/10 pt-3 text-[13.5px] font-medium text-white/80"><Clock3 size={15} className="shrink-0 text-gold-300" aria-hidden="true" /><NextClose auction={endingSoon[0]} offset={offset} /></div>
            </dl>
          </div>
        </section>

        {setupRequired ? (
          <section className={`${CX.card} mx-auto mt-8 max-w-[640px] p-8 text-center`} role="status">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950"><Gavel size={26} aria-hidden="true" /></span>
            <h2 className="mt-4 font-[family-name:var(--font-heading)] text-[24px] font-semibold text-navy-800">The Auction Hall is opening soon</h2>
            <p className="mx-auto mt-2 max-w-[44ch] text-[15px] leading-7 text-ink-muted">We're getting the first lots ready. Check back shortly to see unclaimed items and place your bids.</p>
          </section>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section className="min-w-0" aria-label="Auctions">
              <div className="mb-4 flex flex-col gap-2 rounded-[22px] bg-[linear-gradient(180deg,#14224a_0%,#0b1430_100%)] p-2 ring-1 ring-white/10 sm:flex-row sm:items-center sm:justify-between">
                <div role="tablist" aria-label="Auction views" className="no-scrollbar flex gap-1 overflow-x-auto">
                  {tabs.map((item) => (
                    <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 text-[13.5px] font-semibold transition-colors ${tab === item.id ? "bg-[linear-gradient(160deg,#f3dcab,#d1a153)] text-navy-950 shadow-[0_8px_20px_-10px_rgba(209,161,83,0.9)]" : "text-white/70 hover:bg-white/[0.08] hover:text-white"}`}>
                      {item.label}{item.count !== undefined && <span className={`min-w-[22px] rounded-full px-1.5 text-center text-[12px] tabular-nums ${tab === item.id ? "bg-navy-950/15" : "bg-white/10"}`}>{item.count}</span>}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <label className="relative block flex-1 sm:w-56 sm:flex-none">
                    <span className="sr-only">Search auctions</span>
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" aria-hidden="true" />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lots" className="h-11 w-full rounded-xl border border-white/15 bg-white/[0.07] pl-10 pr-3 text-[16px] text-white outline-none transition-[border-color,box-shadow] placeholder:text-white/45 focus:border-gold-400 focus:shadow-[0_0_0_4px_rgba(209,161,83,0.22)] sm:text-[14.5px]" />
                  </label>
                  <button type="button" onClick={() => setOnlyWatched((v) => !v)} aria-pressed={onlyWatched} aria-label="Show only watched lots" title="Watched lots" className={`flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${onlyWatched ? "border-rose-300/60 bg-rose-500/20 text-rose-200" : "border-white/15 bg-white/[0.07] text-white/75 hover:border-gold-400 hover:text-white"}`}>
                    <Heart size={18} aria-hidden="true" fill={onlyWatched ? "currentColor" : "none"} />
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="space-y-5" aria-busy="true" aria-label="Loading auctions">{[0, 1].map((i) => <div key={i} className={`${CX.card} h-[420px] animate-pulse`} />)}</div>
              ) : error && !feed ? (
                <div role="alert" className={`${CX.card} p-8 text-center`}>
                  <p className="font-semibold text-navy-800">We couldn't load the auctions.</p>
                  <p className="mt-1 text-[14px] text-ink-muted">{error}</p>
                  <button type="button" onClick={() => void refresh()} className={`${CX.btnNavy} mt-4`}>Try again</button>
                </div>
              ) : tab === "live" ? (
                <>
                  {live.length > 0 && (
                    <div className="mb-3 flex items-center justify-end gap-2 text-[13px] text-ink-muted">
                      <label htmlFor="auction-sort">Sort by</label>
                      <select id="auction-sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="rounded-lg border border-line-strong bg-white px-2.5 py-1.5 text-[13px] font-semibold text-navy-800">
                        {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  )}
                  {live.length === 0 ? (
                    liveAll.length === 0 ? (
                      <EmptyHall onResults={() => setTab("sold")} hasUpcoming={upcomingAll.length > 0} onUpcoming={() => setTab("upcoming")} />
                    ) : (
                      <div className={`${CX.card} p-10 text-center`}>
                        <Sparkles size={26} className="mx-auto text-gold-600" aria-hidden="true" />
                        <p className="mt-3 font-semibold text-navy-800">No lots match your search</p>
                        <p className="mx-auto mt-1 max-w-[40ch] text-[14px] leading-6 text-ink-muted">Try a different word or clear the watched filter.</p>
                      </div>
                    )
                  ) : (
                    <div className="grid items-start gap-5 sm:grid-cols-2">
                      {live.map((a) => (
                        <AuctionPost
                          key={a.id}
                          auction={a}
                          offset={offset}
                          watching={watch.watching(a.id)}
                          hearts={watch.countFor(a.id, a.reaction_count ?? 0)}
                          onToggleWatch={watch.toggle}
                          onOpen={openAuction}
                          onPlaced={changed}
                          onVerify={onNavigate ? () => onNavigate("profile") : undefined}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : tab === "upcoming" ? (
                upcoming.length === 0 ? <div className={`${CX.card} p-10 text-center text-[14.5px] text-ink-muted`}>No upcoming auctions are scheduled.</div> : (
                  <div className="grid gap-4 sm:grid-cols-2">{upcoming.map((a) => <AuctionTile key={a.id} auction={a} offset={offset} onOpen={(auction) => openAuction(auction)} />)}</div>
                )
              ) : tab === "sold" ? (
                soldGroups.length === 0 ? <div className={`${CX.card} p-10 text-center text-[14.5px] text-ink-muted`}>No results yet. Finished auctions appear here.</div> : (
                  <div className="space-y-8">
                    {soldGroups.map(([month, items]) => (
                      <section key={month} aria-label={month}>
                        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-[22px] font-semibold text-navy-800">{month}</h2>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{items.map((a) => <SoldTile key={a.id} auction={a} onOpen={(auction) => openAuction(auction)} />)}</div>
                      </section>
                    ))}
                  </div>
                )
              ) : tab === "selling" ? (
                <SellingPanel onOpenAuction={openById} onVerify={onNavigate ? () => onNavigate("profile") : undefined} />
              ) : (
                mineError ? <p role="alert" className={CX.alertError}>{mineError}</p> : mine === null ? <div className={`${CX.card} h-40 animate-pulse`} aria-busy="true" /> : mine.length === 0 ? (
                  <div className={`${CX.card} p-10 text-center text-[14.5px] text-ink-muted`}>You haven't placed any bids yet. Open a live lot to make your first bid.</div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {mine.map((a) => (
                      <div key={a.id} className="relative">
                        <AuctionTile auction={a} offset={offset} onOpen={(auction) => openAuction(auction)} />
                        {a.my_state && <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[12.5px] font-bold ${MY_STATE_LABEL[a.my_state].className}`}>{MY_STATE_LABEL[a.my_state].text}</span>}
                      </div>
                    ))}
                  </div>
                )
              )}
            </section>

            <aside className="grid gap-4 sm:grid-cols-2 xl:sticky xl:top-[calc(var(--app-header-h)+28px)] xl:block xl:space-y-4 xl:self-start">
              {endingSoon.length > 0 && (
                <section className="rounded-[22px] bg-[linear-gradient(180deg,#14224a_0%,#0b1430_100%)] p-5 text-white ring-1 ring-white/10" aria-labelledby="ending-soon">
                  <h2 id="ending-soon" className="flex items-center gap-2 text-[15px] font-semibold text-gold-300"><Clock3 size={16} aria-hidden="true" /> Ending soon</h2>
                  <ul className="mt-3 space-y-2.5">
                    {endingSoon.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => openAuction(a)} className="flex min-h-[56px] w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-white/[0.06]">
                          {a.image_url ? <img decoding="async" src={a.image_url} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-gold-300"><Gavel size={18} aria-hidden="true" /></span>}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-white">{a.title}</span>
                            <span className="block text-[13px] font-semibold tabular-nums text-gold-300">{pesoShort(a.current_price)}</span>
                          </span>
                          <AuctionClock auction={a} offset={offset} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {tab !== "selling" && (
                <section className={`${CX.card} p-5`}>
                  <h2 className="flex items-center gap-2 text-[15px] font-semibold text-navy-800"><Store size={17} className="text-gold-600" aria-hidden="true" /> Have something to sell?</h2>
                  <p className="mt-2 text-[13.5px] leading-6 text-ink-muted">List your own item. The office checks it, runs the auction and pays you after pickup, minus a small fee.</p>
                  {signedIn ? <button type="button" onClick={() => setTab("selling")} className={`${CX.btnGold} mt-3 w-full`}>Sell an item</button>
                    : <p className="mt-3 text-[13px] font-semibold text-navy-800">Sign in to list an item.</p>}
                </section>
              )}
              <section className={`${CX.cardNavy} p-5 text-white`}>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold text-gold-300"><ShieldCheck size={17} aria-hidden="true" /> How bidding works</h2>
                <ol className="mt-4 space-y-3 text-[13.5px] leading-6 text-white/80">
                  <li className="flex gap-3"><ListChecks size={16} className="mt-1 shrink-0 text-gold-300" aria-hidden="true" /><span>Bid on a lot right from its card, or open it for photos and the bid list. Bids are binding.</span></li>
                  <li className="flex gap-3"><Clock3 size={16} className="mt-1 shrink-0 text-gold-300" aria-hidden="true" /><span>A bid in the last minutes extends the timer, so nobody gets sniped.</span></li>
                  <li className="flex gap-3"><Trophy size={16} className="mt-1 shrink-0 text-gold-300" aria-hidden="true" /><span>The highest bid wins. We notify you in the app and by email.</span></li>
                  <li className="flex gap-3"><BellRing size={16} className="mt-1 shrink-0 text-gold-300" aria-hidden="true" /><span>Bring your ID to the Lost and Found Office to pay and collect.</span></li>
                </ol>
              </section>
            </aside>
          </div>
        )}
      </div>

      {open && <AuctionDetail auction={open.auction} signedIn={signedIn} focus={open.focus} onClose={closeAuction} onChanged={changed} onVerify={onNavigate ? () => { closeAuction(); onNavigate("profile"); } : undefined} />}
    </main>
  );
}
