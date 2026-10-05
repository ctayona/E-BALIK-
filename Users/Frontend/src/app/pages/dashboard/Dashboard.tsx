import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, GitCompareArrows, LibraryBig, PackageCheck, PackagePlus, Search, SearchX, ShieldCheck, Sparkles } from "lucide-react";
import type { NavigationOptions, Page } from "@/app/types";
import type { User } from "@/app/utils/useAuth";
import { useAuth } from "@/app/utils/useAuth";
import { CX } from "@/app/utils/clay";
import { SkeletonBlock } from "@/app/shared/LoadingSkeleton";
import HeroSlideshow from "@/app/shared/media/HeroSlideshow";
import ItemCollection from "@/app/shared/media/ItemCollection";
import ItemViewer from "@/app/shared/media/ItemViewer";
import type { GalleryItem } from "@/app/shared/media/ItemImage";
import ViewToggle from "@/app/shared/view/ViewToggle";
import { useViewMode } from "@/app/shared/view/useViewMode";

const HERO_SIZE = 6;
const SECTION_SIZE = 8;

type Viewing = { items: GalleryItem[]; index: number } | null;
type MissingScope = "campus" | "mine";

const toFound = (item: any): GalleryItem => ({
  id: item.fpost_id, title: item.item_name, kind: "found", image: item.image_url || undefined,
  category: item.category, location: item.location, date: item.found_date,
  description: item.description, heldAt: item.turnover_location, status: item.status,
});
const toMissing = (item: any): GalleryItem => ({
  id: item.mpost_id, title: item.item_name, kind: "missing", image: item.image_url || undefined,
  category: item.category, location: item.last_location, date: item.last_seen_date,
  description: item.description, status: item.status,
});
const byNewest = (a: GalleryItem, b: GalleryItem) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();

export default function Dashboard({ user, onNavigate }: {
  user: User | null;
  onNavigate: (page: Page, options?: NavigationOptions) => void;
}) {
  const { searchFoundItems, getMissingItems, getPublicMissingItems } = useAuth();
  const [mode] = useViewMode();
  const [searchTerm, setSearchTerm] = useState("");
  const [found, setFound] = useState<GalleryItem[]>([]);
  const [myMissing, setMyMissing] = useState<GalleryItem[]>([]);
  const [campusMissing, setCampusMissing] = useState<GalleryItem[]>([]);
  const [scope, setScope] = useState<MissingScope>("campus");
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Viewing>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([searchFoundItems({}), getMissingItems(), getPublicMissingItems()]).then(([foundResult, mineResult, campusResult]) => {
      if (!active) return;
      setFound((foundResult.items || []).map(toFound).sort(byNewest));
      setMyMissing((mineResult.items || []).map(toMissing).sort(byNewest));
      setCampusMissing((campusResult.items || []).map(toMissing).sort(byNewest));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [getMissingItems, getPublicMissingItems, searchFoundItems]);

  // Photos lead the slideshow; items without photos still appear (branded fallback) if needed.
  const heroItems = useMemo(() => {
    const withPhotos = found.filter((item) => item.image);
    return [...withPhotos, ...found.filter((item) => !item.image)].slice(0, HERO_SIZE);
  }, [found]);

  const recentFound = useMemo(() => found.slice(0, SECTION_SIZE), [found]);
  const missingList = scope === "mine" ? myMissing : campusMissing;
  const recentMissing = useMemo(() => missingList.slice(0, SECTION_SIZE), [missingList]);

  const weekAgo = Date.now() - 7 * 86_400_000;
  const foundThisWeek = found.filter((item) => item.date && new Date(item.date).getTime() >= weekAgo).length;
  const firstName = user?.fname || "there";

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    onNavigate("missing-item", { searchTerm });
  }

  const open = (items: GalleryItem[]) => (_item: GalleryItem, index: number) => setViewing({ items, index });

  const heroOverlay = (
    <div className="text-white">
      <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[13px] font-medium text-gold-200 ring-1 ring-white/15 backdrop-blur">
        <Sparkles size={14} aria-hidden="true" /> Welcome back, {firstName}
      </p>
      <h1 className="mt-4 font-[family-name:var(--font-heading)] text-[32px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[44px] lg:text-[52px]">
        Lost something?<br /><span className="text-gradient-gold">Let's bring it back.</span>
      </h1>
      <form onSubmit={submitSearch} role="search" className="mt-6 flex max-w-[560px] items-center gap-2 rounded-2xl bg-white/95 p-1.5 shadow-[0_20px_50px_-20px_rgba(5,10,30,0.8)] ring-1 ring-white/60 backdrop-blur">
        <label htmlFor="dashboard-search" className="sr-only">Search found items</label>
        <Search size={19} className="ml-3 shrink-0 text-slate-400" aria-hidden="true" />
        <input
          id="dashboard-search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Blue backpack, calculator, Library 3F…"
          enterKeyHint="search"
          className="h-12 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-slate-400 sm:text-[15px]"
        />
        <button type="submit" className={`${CX.btnGold} h-12 shrink-0 px-4 sm:px-5`} aria-label="Search">
          <span className="hidden sm:inline">Search</span><ArrowRight size={17} aria-hidden="true" />
        </button>
      </form>
      <dl className="mt-5 flex flex-wrap gap-2 text-[13px]">
        {[
          { label: "in custody", value: found.length },
          { label: "found this week", value: foundThisWeek },
          { label: "missing on campus", value: campusMissing.length },
        ].map((stat) => (
          <div key={stat.label} className="flex items-baseline gap-1.5 rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15 backdrop-blur">
            <dd className="font-[family-name:var(--font-heading)] text-[16px] font-semibold tabular-nums">{loading ? "–" : stat.value}</dd>
            <dt className="text-navy-100">{stat.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );

  const actions = [
    { label: "I found an item", hint: "Log it and hand it to security", page: "found-item" as Page, icon: PackagePlus, tone: "from-[#e6be76] to-[#c9953f] text-navy-950" },
    { label: "I lost an item", hint: "Get matched to found reports", page: "missing-item" as Page, icon: SearchX, tone: "from-[#3b5394] to-[#1f3160] text-white" },
    { label: "Browse everything", hint: "Missing and in-custody lists", page: "browse-items" as Page, icon: LibraryBig, tone: "from-[#8aa2f3] to-[#5470d6] text-white" },
  ];

  return (
    <main className={CX.page}>
      <div className={`${CX.inner} space-y-8 sm:space-y-10`}>
        {loading ? (
          <SkeletonBlock className="h-[520px] w-full rounded-[28px]" />
        ) : (
          <HeroSlideshow
            items={heroItems}
            label="Recently found items"
            onOpen={open(heroItems)}
            overlay={heroOverlay}
            className="min-h-[540px] lg:min-h-[520px]"
            empty={<div className="px-6 pb-10 text-[15px] text-navy-100 sm:px-10">Nothing is in custody right now. New found items will appear here as soon as they're turned over.</div>}
          />
        )}

        {/* Quick actions */}
        <section aria-label="Quick actions" className="grid gap-3 sm:grid-cols-3">
          {actions.map(({ label, hint, page, icon: Icon, tone }) => (
            <button key={page} type="button" onClick={() => onNavigate(page)} className={`${CX.cardHover} group flex items-center gap-4 p-4 text-left`}>
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-card ${tone}`}><Icon size={21} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink">{label}</span>
                <span className="block text-[13px] text-ink-muted">{hint}</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-iris-600" aria-hidden="true" />
            </button>
          ))}
        </section>

        {/* Recent found items */}
        <DashboardSection
          eyebrow="In custody"
          title="Recent found items"
          icon={<ShieldCheck size={18} aria-hidden="true" />}
          tone="gold"
          count={found.length}
          loading={loading}
          onViewAll={() => onNavigate("browse-items")}
          viewAllLabel="Browse all"
        >
          <ItemCollection
            label="Recent found items"
            items={recentFound}
            mode={mode}
            onOpen={open(recentFound)}
            showKind={false}
            dense
            empty={<EmptyPanel icon={<PackageCheck size={24} aria-hidden="true" />} title="Nothing in custody right now" body="New found items appear here as soon as they're turned over to campus security." />}
          />
        </DashboardSection>

        {/* Recent missing reports */}
        <DashboardSection
          eyebrow={scope === "campus" ? "Across campus" : "Your reports"}
          title="Recent missing reports"
          icon={<SearchX size={18} aria-hidden="true" />}
          tone="mint"
          count={missingList.length}
          loading={loading}
          onViewAll={() => onNavigate(scope === "mine" ? "my-reports" : "browse-items")}
          viewAllLabel={scope === "mine" ? "Manage reports" : "Browse all"}
          extraControl={
            <div role="tablist" aria-label="Missing reports scope" className="inline-flex rounded-xl border border-line bg-white/85 p-1 shadow-card">
              {([["campus", "Campus"], ["mine", "Mine"]] as const).map(([value, labelText]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={scope === value}
                  onClick={() => setScope(value)}
                  className={`h-9 rounded-[9px] px-3 text-[13px] font-semibold transition-colors ${scope === value ? "bg-tide-50 text-tide-700 ring-1 ring-tide-200" : "text-ink-muted hover:text-navy-800"}`}
                >
                  {labelText}{value === "mine" && myMissing.length > 0 && <span className="ml-1 tabular-nums opacity-70">{myMissing.length}</span>}
                </button>
              ))}
            </div>
          }
        >
          <ItemCollection
            label="Recent missing reports"
            items={recentMissing}
            mode={mode}
            onOpen={open(recentMissing)}
            showKind={false}
            dense
            empty={scope === "mine" ? (
              <EmptyPanel
                icon={<SearchX size={24} aria-hidden="true" />}
                title="You have no missing reports"
                body="Report a lost item and we'll compare it with every found item automatically."
                action={<button type="button" onClick={() => onNavigate("missing-item")} className={CX.btnNavy}>Report a lost item</button>}
              />
            ) : (
              <EmptyPanel icon={<SearchX size={24} aria-hidden="true" />} title="No missing reports on campus" body="Public missing reports from students and staff will show up here." />
            )}
          />
        </DashboardSection>

        {myMissing.length > 0 && (
          <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(120deg,#1f3160_0%,#283b6c_55%,#3f58b3_100%)] p-6 text-white shadow-raised sm:p-8">
            <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-tide-500/25 blur-3xl" aria-hidden="true" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-tide-200 ring-1 ring-white/20"><GitCompareArrows size={22} aria-hidden="true" /></span>
                <div>
                  <p className="font-[family-name:var(--font-heading)] text-[20px] font-semibold">Check your possible matches</p>
                  <p className="text-[14px] text-navy-100">We score every found item against your {myMissing.length} active {myMissing.length === 1 ? "report" : "reports"} by category, place, date and description.</p>
                </div>
              </div>
              <button type="button" onClick={() => onNavigate("matches")} className={`${CX.btnGold} shrink-0`}>Review matches <ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          </section>
        )}
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
          ) : myMissing.some((mine) => mine.id === item.id) ? (
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

function DashboardSection({
  eyebrow, title, icon, tone, count, loading, onViewAll, viewAllLabel, extraControl, children,
}: {
  eyebrow: string; title: string; icon: ReactNode; tone: "gold" | "mint"; count: number; loading: boolean;
  onViewAll: () => void; viewAllLabel: string; extraControl?: ReactNode; children: ReactNode;
}) {
  const [mode] = useViewMode();
  const headingId = `section-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${tone === "gold" ? "bg-gold-50 text-gold-700 ring-1 ring-gold-200" : "bg-tide-50 text-tide-700 ring-1 ring-tide-200"}`}>{icon}</span>
          <div className="min-w-0">
            <p className={CX.eyebrow}>{eyebrow}</p>
            <h2 id={headingId} className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-[20px] font-semibold tracking-[-0.01em] text-ink sm:text-[22px]">
              {title}
              <span className="rounded-full bg-white/80 px-2 py-0.5 text-[12px] font-semibold text-ink-muted ring-1 ring-line tabular-nums">{loading ? "…" : count}</span>
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {extraControl}
          <ViewToggle compact />
          <button type="button" onClick={onViewAll} className="hidden h-11 items-center gap-1 rounded-xl px-3 text-[14px] font-semibold text-iris-700 hover:bg-iris-50 sm:inline-flex">
            {viewAllLabel} <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {loading ? (
        mode === "list"
          ? <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} className="h-[88px] w-full rounded-2xl" />)}</div>
          : <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} className="aspect-[4/5] w-full rounded-[22px]" />)}</div>
      ) : children}
      <button type="button" onClick={onViewAll} className={`${CX.btnGhost} mt-4 w-full sm:hidden`}>
        {viewAllLabel} <ArrowRight size={15} aria-hidden="true" />
      </button>
    </section>
  );
}

function EmptyPanel({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-[22px] px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-frost-100 text-iris-600">{icon}</span>
      <div>
        <p className="text-[16px] font-semibold text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-[46ch] text-[14px] text-ink-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}
