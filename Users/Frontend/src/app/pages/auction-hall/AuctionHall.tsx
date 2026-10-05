import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { BellRing, Clock3, Gavel, Heart, ListChecks, Search, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { AuctionClock, AuctionTile, SoldTile } from "@/app/shared/auction/AuctionParts";
import { useWatchlist } from "@/app/shared/auction/useWatchlist";
import { auctionsApi, formatRemaining, msLeft, pesoShort, useAuctionFeed, useNow, type Auction } from "@/app/utils/auctions";
import { authUtils } from "@/app/utils/api";
import { CX } from "@/app/utils/clay";
import type { Page } from "@/app/types";
import AuctionDetail from "@/app/shared/auction/AuctionDetail";
import AuctionPost from "./AuctionPost";

type Tab = "live" | "upcoming" | "sold" | "mine";
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

function monthLabel(value: string) {
  return new Date(value).toLocaleString([], { month: "long", year: "numeric" });
}

export default function AuctionHall({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const { feed, error, setupRequired, loading, offset, refresh } = useAuctionFeed();
  const now = useNow();
  const watch = useWatchlist();
  const signedIn = Boolean(authUtils.getToken());
  const [tab, setTab] = useState<Tab>("live");
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

  const liveAll = useMemo(() => (feed?.live ?? []).filter((a) => a.status === "live" && msLeft(a, now, offset) > 0), [feed, now, offset]);
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
  const nextClose = endingSoon[0] ? msLeft(endingSoon[0], now, offset) : 0;

  const openAuction = (auction: Auction, focus?: "comments") => setOpen({ auction, focus });
  const closeAuction = useCallback(() => setOpen(null), []);
  const changed = useCallback(() => { void refresh(); if (tab === "mine") void loadMine(); }, [refresh, loadMine, tab]);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "live", label: "Live", count: liveAll.length },
    { id: "upcoming", label: "Upcoming", count: upcomingAll.length },
    { id: "sold", label: "Results", count: feed?.past.length ?? 0 },
    ...(signedIn ? [{ id: "mine" as Tab, label: "My bids" }] : []),
  ];

  return (
    <main className={CX.page}>
      <div className={CX.inner}>
        <section className="relative overflow-hidden rounded-[26px] border border-white/15 bg-[#162448] p-6 text-white sm:p-8 lg:p-10" aria-labelledby="auction-hero">
          <div className="absolute -right-12 -top-16 size-64 rounded-full border border-gold-400/15" aria-hidden="true" />
          <div className="absolute -right-2 -top-6 size-44 rounded-full border border-gold-400/10" aria-hidden="true" />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-[13px] font-semibold text-gold-300"><Gavel size={13} aria-hidden="true" /> Auction Hall</span>
              <h1 id="auction-hero" className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl" style={{ fontFamily: "var(--font-heading)" }}>Unclaimed items, a second chance.</h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-white/70">Items nobody claimed within a month go up for bidding. Every peso supports the university's lost-and-found service.</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div><dt className="text-[12.5px] font-medium text-white/55">Live now</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-gold-300">{liveAll.length}</dd></div>
              <div><dt className="text-[12.5px] font-medium text-white/55">Sold so far</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-white">{(feed?.past ?? []).filter((a) => a.sold).length}</dd></div>
              <div className="col-span-2 flex items-center gap-2 border-t border-white/10 pt-3 text-[13px] text-white/70"><Clock3 size={14} className="shrink-0 text-gold-300" aria-hidden="true" />{nextClose > 0 ? `Next auction closes in ${formatRemaining(nextClose)}` : "New auctions are announced here."}</div>
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
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="min-w-0" aria-label="Auctions">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div role="tablist" aria-label="Auction views" className="flex gap-1.5 overflow-x-auto pb-1">
                  {tabs.map((item) => (
                    <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-semibold transition ${tab === item.id ? "border-navy-800 bg-navy-800 text-white" : "border-line-strong bg-white text-ink-soft hover:border-gold-400"}`}>
                      {item.label}{item.count !== undefined && <span className={`min-w-[22px] rounded-full px-1.5 text-center text-[12px] tabular-nums ${tab === item.id ? "bg-white/20" : "bg-frost-100"}`}>{item.count}</span>}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <label className="relative block flex-1 sm:w-56 sm:flex-none">
                    <span className="sr-only">Search auctions</span>
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lots" className={`${CX.input} h-11 w-full pl-10`} />
                  </label>
                  <button type="button" onClick={() => setOnlyWatched((v) => !v)} aria-pressed={onlyWatched} aria-label="Show only watched lots" title="Watched lots" className={`flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${onlyWatched ? "border-rose-300 bg-rose-50 text-rose-600" : "border-line-strong bg-white text-ink-soft hover:border-gold-400"}`}>
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
                    <div className={`${CX.card} p-10 text-center`}>
                      <Sparkles size={26} className="mx-auto text-gold-600" aria-hidden="true" />
                      <p className="mt-3 font-semibold text-navy-800">{liveAll.length === 0 ? "No live auctions right now" : "No lots match your search"}</p>
                      <p className="mx-auto mt-1 max-w-[40ch] text-[14px] leading-6 text-ink-muted">{liveAll.length === 0 ? "New lots are added when items go unclaimed for a month. See what sold recently." : "Try a different word or clear the watched filter."}</p>
                      {liveAll.length === 0 && <button type="button" onClick={() => setTab("sold")} className={`${CX.btnGhost} mt-4`}>View sold lots</button>}
                    </div>
                  ) : (
                    <div className="mx-auto max-w-[680px] space-y-6 lg:mx-0">
                      {live.map((a) => <AuctionPost key={a.id} auction={a} now={now} offset={offset} watching={watch.watching(a.id)} onToggleWatch={watch.toggle} onOpen={openAuction} />)}
                    </div>
                  )}
                </>
              ) : tab === "upcoming" ? (
                upcoming.length === 0 ? <div className={`${CX.card} p-10 text-center text-[14.5px] text-ink-muted`}>No upcoming auctions are scheduled.</div> : (
                  <div className="grid gap-4 sm:grid-cols-2">{upcoming.map((a) => <AuctionTile key={a.id} auction={a} now={now} offset={offset} onOpen={(auction) => openAuction(auction)} />)}</div>
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
              ) : (
                mineError ? <p role="alert" className={CX.alertError}>{mineError}</p> : mine === null ? <div className={`${CX.card} h-40 animate-pulse`} aria-busy="true" /> : mine.length === 0 ? (
                  <div className={`${CX.card} p-10 text-center text-[14.5px] text-ink-muted`}>You haven't placed any bids yet. Open a live lot to make your first bid.</div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {mine.map((a) => (
                      <div key={a.id} className="relative">
                        <AuctionTile auction={a} now={now} offset={offset} onOpen={(auction) => openAuction(auction)} />
                        {a.my_state && <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[12.5px] font-bold ${MY_STATE_LABEL[a.my_state].className}`}>{MY_STATE_LABEL[a.my_state].text}</span>}
                      </div>
                    ))}
                  </div>
                )
              )}
            </section>

            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              {endingSoon.length > 0 && (
                <section className={`${CX.cardSm} p-5`} aria-labelledby="ending-soon">
                  <h2 id="ending-soon" className="flex items-center gap-2 text-[15px] font-semibold text-navy-800"><Clock3 size={16} className="text-gold-700" aria-hidden="true" /> Ending soon</h2>
                  <ul className="mt-3 space-y-2.5">
                    {endingSoon.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => openAuction(a)} className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-navy-50">
                          {a.image_url ? <img decoding="async" src={a.image_url} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-gold-300"><Gavel size={18} aria-hidden="true" /></span>}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-navy-800">{a.title}</span>
                            <span className="block text-[13px] tabular-nums text-ink-muted">{pesoShort(a.current_price)}</span>
                          </span>
                          <AuctionClock auction={a} now={now} offset={offset} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className={`${CX.cardNavy} p-5 text-white`}>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold text-gold-300"><ShieldCheck size={17} aria-hidden="true" /> How bidding works</h2>
                <ol className="mt-4 space-y-3 text-[13.5px] leading-6 text-white/80">
                  <li className="flex gap-3"><ListChecks size={16} className="mt-1 shrink-0 text-gold-300" aria-hidden="true" /><span>Open a lot and enter at least the minimum bid. Bids are binding.</span></li>
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
