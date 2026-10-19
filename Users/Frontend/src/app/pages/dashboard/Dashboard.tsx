import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Gavel, GitCompareArrows, Loader2, PackageCheck, RefreshCw, Search, Share2, X } from "lucide-react";
import type { NavigationOptions, Page } from "@/app/types";
import type { User } from "@/app/utils/useAuth";
import { useAuth } from "@/app/utils/useAuth";
import { feedApi, type FeedCounts, type FeedPost, type FeedStory } from "@/app/utils/api";
import { isCompletedReport } from "@/app/utils/reportLifecycle";
import { useVerificationPrompt } from "@/app/shared/verification/VerificationRequiredModal";
import { CX } from "@/app/utils/clay";
import { SkeletonBlock } from "@/app/shared/LoadingSkeleton";
import ItemViewer from "@/app/shared/media/ItemViewer";
import type { GalleryItem } from "@/app/shared/media/ItemImage";
import AuctionDetail from "@/app/shared/auction/AuctionDetail";
import { useWatchlist } from "@/app/shared/auction/useWatchlist";
import { auctionsApi, msLeft, useAuctionFeed, useClosingTick, type Auction } from "@/app/utils/auctions";
import ComposerCard from "./feed/ComposerCard";
import LeftRail from "./feed/LeftRail";
import { getPreferences, usePreferences } from "@/app/utils/preferences";
import type { ActivityCounts } from "./feed/MyActivity";
import PostCard from "./feed/PostCard";
import RightRail from "./feed/RightRail";
import StoriesBar from "./feed/StoriesBar";
import AuctionFeedCard from "./feed/AuctionFeedCard";
import { FEED_CARD, GOLD_GRADIENT } from "./feed/feedStyle";
import { kindOfReference } from "@/app/utils/shareReport";
import { showToast } from "@/app/shared/toast/toastStore";

type Kind = "all" | "found" | "missing" | "auctions";
/** What the report feed itself can be asked for; "auctions" is not a report list. */
type ReportKind = Exclude<Kind, "auctions">;
type FeedEntry = { type: "post"; key: string; time: number; post: FeedPost; index: number } | { type: "auction"; key: string; time: number; auction: Auction };
type Viewing = { items: GalleryItem[]; index: number } | null;
const PAGE_SIZE = 12;

const toGallery = (post: Pick<FeedPost, "kind" | "reference" | "item_name" | "image_url" | "category" | "location" | "date" | "description" | "status">): GalleryItem => ({
  id: post.reference, title: post.item_name, kind: post.kind, image: post.image_url || undefined, category: post.category,
  location: post.location, date: post.date, description: post.description, status: post.status,
});

/**
 * The report a shared link points to (`/?report=FP1001`). The link is read once and removed from the address bar; it is kept until the page has
 * tried to open it, so signing in first and landing here afterwards still works.
 */
let pendingShare: string | null | undefined;
function takeSharedReference(): string | null {
  if (pendingShare === undefined) {
    const params = new URLSearchParams(window.location.search);
    pendingShare = (params.get("report") || "").trim() || null;
    if (params.has("report")) {
      params.delete("report");
      const rest = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    }
  }
  return pendingShare;
}

/** The auction a shared link points to (`/?auction=<id>`), read once like the shared report. */
let pendingAuction: string | null | undefined;
function takeSharedAuction(): string | null {
  if (pendingAuction === undefined) {
    const params = new URLSearchParams(window.location.search);
    pendingAuction = (params.get("auction") || "").trim() || null;
    if (params.has("auction")) {
      params.delete("auction");
      const rest = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    }
  }
  return pendingAuction;
}

/**
 * The home page, laid out like a social feed in three columns: you and your campus shortcuts on the left; a composer, urgent-item stories
 * and the report posts (with comments and "Helpful") in the middle; the Lost and Found Office and urgent bulletins on the right.
 * On a phone the columns stack and the shortcuts live in the app's own menu.
 */
export default function Dashboard({ user, onNavigate }: {
  user: User | null;
  onNavigate: (page: Page, options?: NavigationOptions) => void;
}) {
  const { getMissingItems, getFoundItems } = useAuth();
  const preferences = usePreferences();
  const [kind, setKind] = useState<Kind>(() => getPreferences().homeFeed);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [stories, setStories] = useState<FeedStory[]>([]);
  const [counts, setCounts] = useState<FeedCounts | null>(null);
  const [more, setMore] = useState<{ has: boolean; before: string | null }>({ has: false, before: null });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [myMissing, setMyMissing] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActivityCounts | null>(null);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [shared, setShared] = useState<FeedPost | null>(null);
  const reduced = useReducedMotion();
  const auctionFeed = useAuctionFeed(30000);
  const closingTick = useClosingTick(auctionFeed.feed?.live ?? [], auctionFeed.offset);
  const watch = useWatchlist();
  const [openAuction, setOpenAuction] = useState<{ auction: Auction; focus?: "comments" } | null>(null);

  const load = useCallback(async (which: ReportKind) => {
    setLoading(true);
    setError("");
    const response = await feedApi.page(which, null, PAGE_SIZE);
    if (response.error || !response.data) {
      setError(response.error || "Unable to load the feed.");
    } else {
      setPosts(response.data.posts);
      setMore({ has: response.data.has_more, before: response.data.next_before });
      if (response.data.stories) setStories(response.data.stories);
      if (response.data.counts) setCounts(response.data.counts);
    }
    setLoading(false);
  }, []);

  const reportKind: ReportKind = kind === "auctions" ? "all" : kind;
  // The Auctions tab shows no reports, so switching to it does not reload the report feed.
  useEffect(() => { if (kind !== "auctions") void load(kind); }, [kind, load]);

  // Live auctions, newest first. `closingTick` re-runs this just after the next auction closes so it leaves the feed without a reload.
  const liveAuctions = useMemo(
    () => (auctionFeed.feed?.live ?? [])
      .filter((auction) => auction.status === "live" && msLeft(auction, Date.now(), auctionFeed.offset) > 0)
      .sort((a, b) => (Date.parse(b.starts_at) || 0) - (Date.parse(a.starts_at) || 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closingTick re-runs this right after an auction closes
    [auctionFeed.feed, auctionFeed.offset, closingTick],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([getMissingItems(), getFoundItems()]).then(([missing, found]) => {
      if (!active) return;
      const lost: Array<{ status?: string; mpost_id: string }> = missing.items || [];
      const handedIn: Array<{ status?: string }> = found.items || [];
      setMyMissing(lost.filter((item) => !isCompletedReport("Missing", item.status)).map((item) => item.mpost_id));
      const completed = lost.filter((item) => isCompletedReport("Missing", item.status)).length + handedIn.filter((item) => isCompletedReport("Found", item.status)).length;
      setActivity({ found: handedIn.length, missing: lost.length, completed, open: lost.length + handedIn.length - completed });
    });
    return () => { active = false; };
  }, [getMissingItems, getFoundItems]);

  // A report someone shared with this person: shown at the top of the feed, whether or not it is on the first page.
  useEffect(() => {
    const reference = takeSharedReference();
    if (!reference) return;
    const sharedKind = kindOfReference(reference);
    if (!sharedKind) {
      pendingShare = null;
      showToast("That link does not point to a report.", "error");
      return;
    }
    let active = true;
    void feedApi.post(sharedKind, reference).then((response) => {
      if (!active) return;
      pendingShare = null;
      if (response.data?.post) setShared(response.data.post);
      else showToast(response.error || "That report could not be opened.", "error");
    });
    return () => { active = false; };
  }, []);

  // An auction someone shared: open its window straight away.
  useEffect(() => {
    const id = takeSharedAuction();
    if (!id) return;
    let active = true;
    void auctionsApi.detail(id).then(
      (detail) => { if (active) { pendingAuction = null; setOpenAuction({ auction: detail.auction }); } },
      () => { if (active) { pendingAuction = null; showToast("That auction could not be opened. It may have closed.", "error"); } },
    );
    return () => { active = false; };
  }, []);

  async function loadMore() {
    if (!more.has || loadingMore || kind === "auctions") return;
    setLoadingMore(true);
    const response = await feedApi.page(reportKind, more.before, PAGE_SIZE);
    if (response.error || !response.data) {
      setError(response.error || "Unable to load more posts.");
    } else {
      const seen = new Set(posts.map((post) => `${post.kind}-${post.reference}`));
      setPosts((current) => [...current, ...response.data!.posts.filter((post) => !seen.has(`${post.kind}-${post.reference}`))]);
      setMore({ has: response.data.has_more, before: response.data.next_before });
    }
    setLoadingMore(false);
  }

  // Looking at a public report, commenting and reacting all need a verified account: everyone else gets a pop-up with a button to the Profile page.
  const view = useVerificationPrompt(onNavigate, "view this report");
  const social = useVerificationPrompt(onNavigate, "comment on or react to a report");

  const postItems = useMemo(() => posts.map(toGallery), [posts]);
  const storyItems = useMemo(() => stories.map(toGallery), [stories]);
  const openPost = view.guard((index: number) => setViewing({ items: postItems, index }));
  const openStory = view.guard((index: number) => setViewing({ items: storyItems, index }));
  const openShared = view.guard(() => { if (shared) setViewing({ items: [toGallery(shared)], index: 0 }); });

  // What the list shows. In "All posts" live auctions sit between the reports by the time they opened; while more reports are still to
  // load, only auctions newer than the oldest loaded report are mixed in, so older ones do not jump in front of reports that are not shown yet.
  const entries = useMemo<FeedEntry[]>(() => {
    if (kind === "auctions") return liveAuctions.map((auction) => ({ type: "auction", key: `auction-${auction.id}`, time: Date.parse(auction.starts_at) || 0, auction }));
    const reports: FeedEntry[] = posts.map((post, index) => ({ type: "post", key: `${post.kind}-${post.reference}`, time: Date.parse(post.created_at) || 0, post, index }));
    if (kind !== "all") return reports;
    const oldest = posts.length ? Date.parse(posts[posts.length - 1].created_at) || 0 : 0;
    const auctions: FeedEntry[] = liveAuctions
      .filter((auction) => !more.has || (Date.parse(auction.starts_at) || 0) >= oldest)
      .map((auction) => ({ type: "auction", key: `auction-${auction.id}`, time: Date.parse(auction.starts_at) || 0, auction }));
    return [...reports, ...auctions].sort((a, b) => b.time - a.time);
  }, [kind, posts, liveAuctions, more.has]);

  const openAuctionWindow = useCallback((auction: Auction, focus?: "comments") => setOpenAuction({ auction, focus }), []);
  const closeAuction = useCallback(() => setOpenAuction(null), []);

  function primaryAction(post: FeedPost) {
    if (post.kind === "found") onNavigate("claim", { foundItemId: post.reference });
    else if (myMissing.includes(post.reference)) onNavigate("matches", { reportId: post.reference });
    else onNavigate("found-item", { mode: "form" });
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    onNavigate("missing-item", { searchTerm });
  }

  const tabs: Array<{ value: Kind; label: string; count?: number }> = [
    { value: "all", label: "All posts" },
    { value: "found", label: "Found", count: counts?.found },
    { value: "missing", label: "Missing", count: counts?.missing },
    ...(auctionFeed.setupRequired ? [] : [{ value: "auctions" as Kind, label: "Auctions", count: auctionFeed.loading ? undefined : liveAuctions.length }]),
  ];

  return (
    <main className={CX.page}>
      {view.prompt}
      {social.prompt}
      <div className="mx-auto w-full max-w-[1320px]">
        <div className={`grid grid-cols-[minmax(0,1fr)] items-start gap-5 ${preferences.focusFeed ? "" : "lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_320px]"}`}>
          <div className={`hidden lg:sticky lg:top-[calc(var(--app-header-h)+28px)] lg:max-h-[calc(100vh-var(--app-header-h)-3rem)] lg:overflow-y-auto lg:pb-2 no-scrollbar ${preferences.focusFeed ? "" : "lg:block"}`}>
            <LeftRail user={user} activeReports={myMissing.length} activity={activity} onNavigate={onNavigate} />
          </div>

          <div className={`mx-auto w-full min-w-0 max-w-[680px] space-y-4 ${preferences.focusFeed ? "" : "xl:max-w-none"}`}>
            <h1 className="sr-only">Home feed</h1>
            <form onSubmit={submitSearch} role="search" className={`${FEED_CARD} flex items-center gap-2 !rounded-2xl p-1.5 transition-shadow duration-200 focus-within:shadow-[0_0_0_4px_rgba(110,142,240,0.16),var(--shadow-card)]`}>
              <label htmlFor="dashboard-search" className="sr-only">Search found items</label>
              <Search size={18} className="ml-3 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                id="dashboard-search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Lost something? Search: blue backpack, calculator, Library 3F…"
                enterKeyHint="search"
                className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-slate-400 sm:text-[15px]"
              />
              <button type="submit" className={`${CX.btnGold} h-11 shrink-0 px-4`} aria-label="Search"><span className="hidden sm:inline">Search</span><ArrowRight size={16} aria-hidden="true" /></button>
            </form>

            {shared && (
              <section aria-label="Shared with you" className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-iris-700"><Share2 size={14} aria-hidden="true" />Shared with you</p>
                  <button type="button" onClick={() => setShared(null)} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink-muted hover:bg-frost-100 hover:text-ink sm:min-h-[36px]"><X size={14} aria-hidden="true" />Dismiss</button>
                </div>
                <PostCard post={shared} user={user} mine={shared.kind === "missing" && myMissing.includes(shared.reference)} ensureVerified={social.ensure} onOpenImage={openShared} onPrimary={() => primaryAction(shared)} />
              </section>
            )}

            <ComposerCard user={user} onNavigate={onNavigate} />
            <StoriesBar stories={stories} loading={loading && stories.length === 0} onOpen={openStory} onCreate={() => onNavigate("report-item")} />

            <div className={preferences.focusFeed ? "" : "xl:hidden"}><RightRail counts={counts} urgent={stories.length} compact /></div>


            {myMissing.length > 0 && (
              <section className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(120deg,#1f3160_0%,#283b6c_55%,#3f58b3_100%)] p-4 text-white shadow-raised ring-1 ring-white/10 sm:p-5">
                <div className="pointer-events-none absolute -right-12 -top-12 size-48 rounded-full bg-tide-500/25 blur-3xl" aria-hidden="true" />
                <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-tide-200 ring-1 ring-white/20"><GitCompareArrows size={20} aria-hidden="true" /></span>
                    <div>
                      <p className="font-[family-name:var(--font-heading)] text-[17px] font-semibold">Check your possible matches</p>
                      <p className="text-[13.5px] text-navy-100">We compare every found item with your {myMissing.length} active {myMissing.length === 1 ? "report" : "reports"}.</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => onNavigate("matches")} className={`${CX.btnGold} shrink-0`}>Review matches <ArrowRight size={16} aria-hidden="true" /></button>
                </div>
              </section>
            )}

            <div role="tablist" aria-label="Filter the feed" className={`${FEED_CARD} flex gap-1 overflow-x-auto !rounded-2xl p-1.5`}>
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={kind === tab.value}
                  onClick={() => setKind(tab.value)}
                  className={`relative min-h-[44px] flex-1 whitespace-nowrap rounded-xl px-3.5 text-[14px] font-semibold transition-colors ${kind === tab.value ? "text-white" : "text-ink-soft hover:bg-frost-100"}`}
                >
                  {kind === tab.value && (
                    <motion.span
                      layoutId="feed-tab"
                      className="absolute inset-0 rounded-xl bg-[linear-gradient(180deg,#2e4687_0%,#1f3160_100%)] shadow-[0_8px_18px_-8px_rgba(31,49,96,0.9),inset_0_1px_0_rgba(255,255,255,0.14)]"
                      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
                    />
                  )}
                  <span className="relative">{tab.label}{tab.count != null && <span className={`ml-1.5 tabular-nums ${kind === tab.value ? "text-gold-300" : "text-ink-muted"}`}>{tab.count}</span>}</span>
                </button>
              ))}
            </div>

            {error && kind !== "auctions" && (
              <div role="alert" className={`${CX.alertError} flex flex-wrap items-center justify-between gap-3`}>
                <span>{error}</span>
                <button type="button" onClick={() => void load(reportKind)} className={`${CX.btnGhost} min-h-[44px] px-3 text-[13px] sm:min-h-[38px]`}><RefreshCw size={14} aria-hidden="true" />Try again</button>
              </div>
            )}

            {kind !== "auctions" && loading && posts.length === 0 ? (
              <div className="space-y-4" aria-busy="true">{Array.from({ length: 2 }, (_, index) => <SkeletonBlock key={index} className="h-[420px] w-full rounded-[22px]" />)}</div>
            ) : entries.length === 0 && (!error || kind === "auctions") ? (
              <div className={`${FEED_CARD} flex flex-col items-center gap-3 px-6 py-12 text-center`}>
                <span className={`flex size-14 items-center justify-center rounded-2xl text-navy-950 shadow-[0_10px_24px_-12px_rgba(209,161,83,0.9)] ${GOLD_GRADIENT}`}>{kind === "auctions" ? <Gavel size={26} aria-hidden="true" /> : <PackageCheck size={26} aria-hidden="true" />}</span>
                <div>
                  <p className="text-[16px] font-semibold text-ink">{kind === "auctions" ? "No live auctions right now" : kind === "found" ? "Nothing is in custody right now" : kind === "missing" ? "No open missing reports" : "The feed is quiet"}</p>
                  <p className="mx-auto mt-1 max-w-[46ch] text-[14px] text-ink-muted">{kind === "auctions" ? "Items unclaimed for a month are auctioned here. See what sold recently in the Auction Hall." : "New found items and missing reports from the campus appear here as soon as they are posted."}</p>
                </div>
                {kind === "auctions" && <button type="button" onClick={() => onNavigate("auction-hall")} className={`${CX.btnGhost} mt-1`}>Open the Auction Hall <ArrowRight size={15} aria-hidden="true" /></button>}
              </div>
            ) : (
              <div className={`space-y-4 transition-opacity ${loading && kind !== "auctions" ? "opacity-60" : ""}`}>
                {entries.map((entry) => entry.type === "post" ? (
                  <PostCard
                    key={entry.key}
                    post={entry.post}
                    user={user}
                    mine={entry.post.kind === "missing" && myMissing.includes(entry.post.reference)}
                    ensureVerified={social.ensure}
                    onOpenImage={() => openPost(entry.index)}
                    onPrimary={() => primaryAction(entry.post)}
                  />
                ) : (
                  <AuctionFeedCard
                    key={entry.key}
                    auction={entry.auction}
                    offset={auctionFeed.offset}
                    watching={watch.watching(entry.auction.id)}
                    hearts={watch.countFor(entry.auction.id, entry.auction.reaction_count ?? 0)}
                    onToggleWatch={watch.toggle}
                    onOpen={openAuctionWindow}
                  />
                ))}
                {kind === "auctions" ? (
                  <button type="button" onClick={() => onNavigate("auction-hall")} className={`${CX.btnGhost} w-full`}>Open the Auction Hall <ArrowRight size={15} aria-hidden="true" /></button>
                ) : more.has ? (
                  <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={`${CX.btnGhost} w-full`}>
                    {loadingMore ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Loading…</> : "Show more posts"}
                  </button>
                ) : (
                  <p className="py-2 text-center text-[13px] text-ink-muted">You are all caught up.</p>
                )}
              </div>
            )}
          </div>

          <div className={`hidden xl:sticky xl:top-[calc(var(--app-header-h)+28px)] ${preferences.focusFeed ? "" : "xl:block"}  xl:max-h-[calc(100vh-var(--app-header-h)-3rem)] xl:overflow-y-auto xl:pb-2 no-scrollbar`}>
            <RightRail counts={counts} urgent={stories.length} />
          </div>
        </div>
      </div>

      {openAuction && (
        <AuctionDetail
          auction={openAuction.auction}
          signedIn
          focus={openAuction.focus}
          onClose={closeAuction}
          onChanged={() => void auctionFeed.refresh()}
          onVerify={() => { closeAuction(); onNavigate("profile"); }}
        />
      )}

      {viewing && (
        <ItemViewer
          items={viewing.items}
          index={viewing.index}
          onIndexChange={(index) => setViewing((current) => (current ? { ...current, index } : current))}
          onClose={() => setViewing(null)}
          actions={(item) => item.kind === "found" ? (
            <>
              <button type="button" onClick={() => { setViewing(null); onNavigate("claim", { foundItemId: item.id }); }} className={`${CX.btnGold} w-full`}>
                This is mine, start a claim <ArrowRight size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => { setViewing(null); onNavigate("browse-items"); }} className={`${CX.btnGhost} w-full`}>Browse similar items</button>
            </>
          ) : myMissing.includes(item.id) ? (
            <button type="button" onClick={() => { setViewing(null); onNavigate("matches", { reportId: item.id }); }} className={`${CX.btnNavy} w-full`}>
              See possible matches <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={() => { setViewing(null); onNavigate("found-item", { mode: "form" }); }} className={`${CX.btnNavy} w-full`}>
              I found this item <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
        />
      )}
    </main>
  );
}
