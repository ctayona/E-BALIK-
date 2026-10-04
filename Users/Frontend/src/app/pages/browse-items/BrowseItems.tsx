import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, ImageOff, LayoutGrid, List, MapPin, Search, SearchX, ShieldCheck, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { NavigationOptions, Page } from "@/app/types";
import { useAuth } from "@/app/utils/useAuth";
import { CX, SPRING } from "@/app/utils/clay";
import { ReportGridSkeleton } from "@/app/shared/LoadingSkeleton";

type Item = {
  mpost_id?: string; fpost_id?: string; item_name: string; category?: string;
  location?: string; last_location?: string; found_date?: string;
  last_seen_date?: string; image_url?: string; status?: string; description?: string;
};
type Tab = "missing" | "custody";
const PAGE_SIZE = 9;

const itemId = (item: Item) => item.mpost_id || item.fpost_id || "";
const itemPlace = (item: Item) => item.last_location || item.location || "Location not recorded";
const itemDate = (item: Item) => item.last_seen_date || item.found_date || "";

function ItemImage({ item, className }: { item: Item; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!item.image_url || failed)
    return <div className={`${className} flex items-center justify-center bg-slate-100 text-slate-400`}><ImageOff size={22} aria-hidden="true" /></div>;
  return <img src={item.image_url} alt={item.item_name} loading="lazy" className={className} onError={() => setFailed(true)} />;
}

function KindBadge({ tab }: { tab: Tab }) {
  return tab === "missing"
    ? <span className={CX.badgeTide}><Search size={13} aria-hidden="true" />Missing</span>
    : <span className={CX.badgeGold}><ShieldCheck size={13} aria-hidden="true" />In custody</span>;
}

export default function BrowseItems({ onNavigate }: { onNavigate?: (page: Page, options?: NavigationOptions) => void }) {
  const { getPublicMissingItems, searchFoundItems } = useAuth();
  const [tab,      setTab]      = useState<Tab>("missing");
  const [mode,     setMode]     = useState<"tile" | "list">("tile");
  const [items,    setItems]    = useState<Item[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [query,    setQuery]    = useState("");
  const [category, setCategory] = useState("");
  const [sort,     setSort]     = useState<"newest" | "oldest">("newest");
  const [page,     setPage]     = useState(0);
  const [selected, setSelected] = useState<Item | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const request = tab === "missing" ? getPublicMissingItems() : searchFoundItems({});
    void request.then((result) => {
      if (!active) return;
      setItems((result.items || []) as Item[]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [getPublicMissingItems, searchFoundItems, tab]);

  useEffect(() => setPage(0), [tab, mode, query, category, sort]);
  useEffect(() => setCategory(""), [tab]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => { if (item.category) counts.set(item.category, (counts.get(item.category) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = items.filter((item) => {
      const text = `${item.item_name} ${itemPlace(item)} ${item.description || ""} ${item.category || ""} ${itemId(item)}`.toLowerCase();
      return (!needle || text.includes(needle)) && (!category || item.category === category);
    });
    return result.sort((a, b) => {
      const diff = new Date(itemDate(b) || 0).getTime() - new Date(itemDate(a) || 0).getTime();
      return sort === "newest" ? diff : -diff;
    });
  }, [items, query, category, sort]);

  const pageSize = mode === "tile" ? PAGE_SIZE : 10;
  const pages    = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current  = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const rangeStart = filtered.length === 0 ? 0 : page * pageSize + 1;
  const rangeEnd   = Math.min(filtered.length, (page + 1) * pageSize);
  const hasFilters = Boolean(query || category);

  function clearFilters() {
    setQuery("");
    setCategory("");
  }

  const chip = (active: boolean) =>
    `inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
      active ? "border-navy-800 bg-navy-800 text-white" : "border-line-strong bg-white text-ink-soft hover:border-navy-300 hover:bg-navy-50"
    }`;

  return (
    <main className={CX.page}>
      <div className={CX.inner}>

        {/* Page header */}
        <header className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className={CX.eyebrow}>Campus listings</p>
            <h1 className={`${CX.pageTitle} mt-1`}>Browse items</h1>
            <p className={CX.pageLead}>Check public missing reports, or look through items being held by campus security.</p>
          </div>
          <div role="tablist" aria-label="Listing type" className="inline-flex shrink-0 rounded-[12px] border border-line bg-white p-1 shadow-card">
            {([["missing", "Missing reports"], ["custody", "In custody"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`min-h-[40px] rounded-[9px] px-4 text-[14px] font-semibold transition-colors ${tab === value ? "bg-navy-800 text-white" : "text-ink-soft hover:bg-navy-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {/* Toolbar */}
        <section aria-label="Filters" className={`${CX.card} sticky top-[72px] z-10 mb-5 p-3 sm:p-4`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <label htmlFor="browse-search" className="sr-only">Search listings</label>
              <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="browse-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by item, place, details, or report ID"
                className={`${CX.input} w-full pl-10`}
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="browse-sort" className="sr-only">Sort</label>
              <select id="browse-sort" value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest")} className={`${CX.input} pr-8`}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
              <div className="flex rounded-[var(--radius-control)] border border-line-strong bg-white p-1" role="group" aria-label="View mode">
                {([["tile", LayoutGrid, "Grid view"], ["list", List, "List view"]] as const).map(([value, Icon, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    aria-label={label}
                    title={label}
                    onClick={() => setMode(value)}
                    className={`flex size-[34px] items-center justify-center rounded-[7px] transition-colors ${mode === value ? "bg-navy-800 text-white" : "text-ink-muted hover:bg-navy-50"}`}
                  >
                    <Icon size={17} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          </div>
          {categories.length > 0 && (
            <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]" role="group" aria-label="Category">
              <button type="button" aria-pressed={!category} onClick={() => setCategory("")} className={chip(!category)}>All <span className="tabular-nums opacity-70">{items.length}</span></button>
              {categories.map(([name, count]) => (
                <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(category === name ? "" : name)} className={chip(category === name)}>
                  {name} <span className="tabular-nums opacity-70">{count}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="mb-3 flex items-center justify-between gap-3 text-[14px] text-ink-muted" aria-live="polite">
          <span>{loading ? "Loading listings…" : filtered.length === 0 ? "No results" : <>Showing <span className="font-semibold text-ink tabular-nums">{rangeStart}–{rangeEnd}</span> of <span className="font-semibold text-ink tabular-nums">{filtered.length}</span></>}</span>
          {hasFilters && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-navy-700 hover:bg-navy-50"><X size={14} aria-hidden="true" />Clear filters</button>}
        </div>

        {/* Items */}
        {loading ? (
          <ReportGridSkeleton count={6} />
        ) : current.length === 0 ? (
          <div className={`${CX.card} flex flex-col items-center px-6 py-14 text-center`}>
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><SearchX size={26} aria-hidden="true" /></span>
            <p className="mt-3 text-[16px] font-semibold text-ink">{hasFilters ? "No listings match your filters" : tab === "missing" ? "No missing reports yet" : "No items in custody right now"}</p>
            <p className="mt-1 max-w-[46ch] text-[14px] text-ink-muted">{hasFilters ? "Try a broader word, a different category, or clear the filters." : "Check back soon; listings update as reports come in."}</p>
            {hasFilters && <button type="button" onClick={clearFilters} className={`${CX.btnGhost} mt-4`}>Clear filters</button>}
          </div>
        ) : mode === "tile" ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {current.map((item) => (
              <li key={itemId(item)}>
                <button type="button" onClick={() => setSelected(item)} className={`${CX.cardHover} group block w-full overflow-hidden text-left`}>
                  <div className="relative">
                    <ItemImage item={item} className="aspect-[16/10] w-full object-cover" />
                    <span className="absolute left-3 top-3"><KindBadge tab={tab} /></span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="min-w-0 text-[16px] font-semibold leading-snug text-ink group-hover:text-navy-700">{item.item_name}</h2>
                      <span className="shrink-0 pt-0.5 font-mono text-[12px] text-ink-muted">{itemId(item)}</span>
                    </div>
                    <p className="mt-1 text-[13px] text-ink-muted">{item.category || "Uncategorized"}</p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[13px] text-ink-soft">
                      <span className="flex min-w-0 items-center gap-1.5"><MapPin size={14} className="shrink-0 text-gold-600" aria-hidden="true" /><span className="truncate">{itemPlace(item)}</span></span>
                      <span className="flex items-center gap-1.5 tabular-nums"><CalendarDays size={14} className="shrink-0 text-gold-600" aria-hidden="true" />{itemDate(item) || "No date"}</span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className={`${CX.card} overflow-hidden`}>
            <ul className="divide-y divide-line">
              {current.map((item) => (
                <li key={itemId(item)}>
                  <button type="button" onClick={() => setSelected(item)} className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50">
                    <ItemImage item={item} className="size-14 shrink-0 rounded-lg object-cover" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">{item.item_name}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-ink-muted">{item.category || "Uncategorized"} · {itemPlace(item)}</span>
                    </span>
                    <span className="hidden w-28 text-[13px] text-ink-soft tabular-nums sm:block">{itemDate(item)}</span>
                    <span className="hidden w-20 font-mono text-[12px] text-ink-muted md:block">{itemId(item)}</span>
                    <ChevronRight size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-1.5" aria-label="Pagination">
            <button type="button" onClick={() => setPage((v) => Math.max(0, v - 1))} disabled={page === 0} className={`${CX.btnGhost} size-11 px-0`} aria-label="Previous page">
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            {Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - page) <= 1).map((i, idx, arr) => (
              <span key={i} className="flex items-center gap-1.5">
                {idx > 0 && i - arr[idx - 1] > 1 && <span className="px-1 text-ink-muted" aria-hidden="true">…</span>}
                <button
                  type="button"
                  onClick={() => setPage(i)}
                  aria-current={i === page ? "page" : undefined}
                  className={`size-11 rounded-[var(--radius-control)] text-[14px] font-semibold tabular-nums transition-colors ${i === page ? "bg-navy-800 text-white" : "border border-line-strong bg-white text-ink-soft hover:bg-navy-50"}`}
                >
                  {i + 1}
                </button>
              </span>
            ))}
            <button type="button" onClick={() => setPage((v) => Math.min(pages - 1, v + 1))} disabled={page >= pages - 1} className={`${CX.btnGhost} size-11 px-0`} aria-label="Next page">
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </nav>
        )}

        {/* Item detail modal */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key="detail-overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/55 backdrop-blur-[4px] sm:items-center sm:p-4"
              onClick={() => setSelected(null)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="browse-detail-title"
                initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
                transition={SPRING}
                onClick={(e) => e.stopPropagation()}
                className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl border border-line bg-white shadow-overlay sm:rounded-2xl"
              >
                <div className="relative">
                  <ItemImage item={selected} className="h-[230px] w-full bg-slate-50 object-contain" />
                  <button type="button" aria-label="Close item details" onClick={() => setSelected(null)} className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full bg-white/95 text-ink shadow-card hover:bg-white">
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
                <div className="overflow-y-auto p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <KindBadge tab={tab} />
                    <span className="font-mono text-[12px] text-ink-muted">{itemId(selected)}</span>
                  </div>
                  <h2 id="browse-detail-title" className="mt-2 font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-snug text-ink">{selected.item_name}</h2>
                  <p className="mt-2 whitespace-pre-line text-[15px] leading-6 text-ink-soft">{selected.description || "No public description provided."}</p>
                  <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5">
                    {[
                      { label: "Category", value: selected.category || "Uncategorized" },
                      { label: tab === "missing" ? "Last seen at" : "Found at", value: itemPlace(selected) },
                      { label: tab === "missing" ? "Date lost" : "Date found", value: itemDate(selected) || "Not recorded" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <dt className="text-[12px] font-medium text-ink-muted">{label}</dt>
                        <dd className="mt-0.5 text-[15px] font-semibold text-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {tab === "missing" && (
                    <p className={`${CX.alertInfo} mt-5`}>Found this item? Report it as found so the owner gets matched automatically.</p>
                  )}
                </div>
                {onNavigate && (
                  <div className="flex flex-col-reverse gap-2 border-t border-line bg-slate-50/70 p-4 sm:flex-row sm:justify-end">
                    {tab === "custody" ? (
                      <button type="button" onClick={() => { onNavigate("claim", { foundItemId: itemId(selected) }); setSelected(null); }} className={CX.btnGold}>
                        This is mine, start a claim <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    ) : (
                      <button type="button" onClick={() => { onNavigate("found-item", { mode: "form" }); setSelected(null); }} className={CX.btnNavy}>
                        I found this item <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </main>
  );
}
