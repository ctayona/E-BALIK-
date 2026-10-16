import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, GitCompareArrows, Loader2, PackageCheck, RefreshCw, Search } from "lucide-react";
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
import AuctionShelf from "@/app/shared/auction/AuctionShelf";
import ComposerCard from "./feed/ComposerCard";
import LeftRail from "./feed/LeftRail";
import PostCard from "./feed/PostCard";
import RightRail from "./feed/RightRail";
import StoriesBar from "./feed/StoriesBar";

type Kind = "all" | "found" | "missing";
type Viewing = { items: GalleryItem[]; index: number } | null;
const PAGE_SIZE = 12;

const toGallery = (post: Pick<FeedPost, "kind" | "reference" | "item_name" | "image_url" | "category" | "location" | "date" | "description" | "status">): GalleryItem => ({
  id: post.reference, title: post.item_name, kind: post.kind, image: post.image_url || undefined, category: post.category,
  location: post.location, date: post.date, description: post.description, status: post.status,
});

/**
 * The home page, laid out like a social feed in three columns: you and your campus shortcuts on the left; a composer, urgent-item stories
 * and the report posts (with comments and "Helpful") in the middle; the Lost and Found Office and urgent bulletins on the right.
 * On a phone the columns stack and the shortcuts live in the app's own menu.
 */
export default function Dashboard({ user, onNavigate }: {
  user: User | null;
  onNavigate: (page: Page, options?: NavigationOptions) => void;
}) {
  const { getMissingItems } = useAuth();
  const [kind, setKind] = useState<Kind>("all");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [stories, setStories] = useState<FeedStory[]>([]);
  const [counts, setCounts] = useState<FeedCounts | null>(null);
  const [more, setMore] = useState<{ has: boolean; before: string | null }>({ has: false, before: null });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [myMissing, setMyMissing] = useState<string[]>([]);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const load = useCallback(async (which: Kind) => {
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

  useEffect(() => { void load(kind); }, [kind, load]);

  useEffect(() => {
    let active = true;
    void getMissingItems().then((result) => {
      if (!active) return;
      setMyMissing((result.items || []).filter((item: { status?: string }) => !isCompletedReport("Missing", item.status)).map((item: { mpost_id: string }) => item.mpost_id));
    });
    return () => { active = false; };
  }, [getMissingItems]);

  async function loadMore() {
    if (!more.has || loadingMore) return;
    setLoadingMore(true);
    const response = await feedApi.page(kind, more.before, PAGE_SIZE);
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
  ];

  return (
    <main className={CX.page}>
      {view.prompt}
      {social.prompt}
      <div className="mx-auto w-full max-w-[1320px]">
        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_320px]">
          <div className="hidden lg:sticky lg:top-24 lg:block">
            <LeftRail user={user} activeReports={myMissing.length} onNavigate={onNavigate} />
          </div>

          <div className="mx-auto w-full max-w-[680px] space-y-4 xl:max-w-none">
            <h1 className="sr-only">Home feed</h1>
            <form onSubmit={submitSearch} role="search" className="flex items-center gap-2 rounded-2xl border border-white/80 bg-white/90 p-1.5 shadow-card">
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

            <ComposerCard user={user} onNavigate={onNavigate} />
            <StoriesBar stories={stories} loading={loading && stories.length === 0} onOpen={openStory} onCreate={() => onNavigate("report-item")} />

            <div className="xl:hidden"><RightRail counts={counts} urgent={stories.length} compact /></div>

            <AuctionShelf onViewAll={() => onNavigate("auction-hall")} onVerify={() => onNavigate("profile")} />

            {myMissing.length > 0 && (
              <section className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(120deg,#1f3160_0%,#283b6c_55%,#3f58b3_100%)] p-4 text-white shadow-raised sm:p-5">
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

            <div role="tablist" aria-label="Filter the feed" className="flex gap-1.5 overflow-x-auto rounded-2xl border border-white/80 bg-white/90 p-1.5 shadow-card">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={kind === tab.value}
                  onClick={() => setKind(tab.value)}
                  className={`min-h-[40px] flex-1 whitespace-nowrap rounded-xl px-3.5 text-[14px] font-semibold transition-colors ${kind === tab.value ? "bg-[#1f3160] text-white shadow-card" : "text-ink-soft hover:bg-frost-100"}`}
                >
                  {tab.label}{tab.count != null && <span className={`ml-1.5 tabular-nums ${kind === tab.value ? "text-gold-300" : "text-ink-muted"}`}>{tab.count}</span>}
                </button>
              ))}
            </div>

            {error && (
              <div role="alert" className={`${CX.alertError} flex flex-wrap items-center justify-between gap-3`}>
                <span>{error}</span>
                <button type="button" onClick={() => void load(kind)} className={`${CX.btnGhost} min-h-[38px] px-3 text-[13px]`}><RefreshCw size={14} aria-hidden="true" />Try again</button>
              </div>
            )}

            {loading && posts.length === 0 ? (
              <div className="space-y-4" aria-busy="true">{Array.from({ length: 2 }, (_, index) => <SkeletonBlock key={index} className="h-[420px] w-full rounded-[20px]" />)}</div>
            ) : posts.length === 0 && !error ? (
              <div className="glass flex flex-col items-center gap-3 rounded-[20px] px-6 py-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-frost-100 text-iris-600"><PackageCheck size={24} aria-hidden="true" /></span>
                <div>
                  <p className="text-[16px] font-semibold text-ink">{kind === "found" ? "Nothing is in custody right now" : kind === "missing" ? "No open missing reports" : "The feed is quiet"}</p>
                  <p className="mx-auto mt-1 max-w-[46ch] text-[14px] text-ink-muted">New found items and missing reports from the campus appear here as soon as they are posted.</p>
                </div>
              </div>
            ) : (
              <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
                {posts.map((post, index) => (
                  <PostCard
                    key={`${post.kind}-${post.reference}`}
                    post={post}
                    user={user}
                    mine={post.kind === "missing" && myMissing.includes(post.reference)}
                    ensureVerified={social.ensure}
                    onOpenImage={() => openPost(index)}
                    onPrimary={() => primaryAction(post)}
                  />
                ))}
                {more.has ? (
                  <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={`${CX.btnGhost} w-full`}>
                    {loadingMore ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Loading…</> : "Show more posts"}
                  </button>
                ) : (
                  <p className="py-2 text-center text-[13px] text-ink-muted">You are all caught up.</p>
                )}
              </div>
            )}
          </div>

          <div className="hidden xl:sticky xl:top-24 xl:block xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pb-2 no-scrollbar">
            <RightRail counts={counts} urgent={stories.length} />
          </div>
        </div>
      </div>

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
