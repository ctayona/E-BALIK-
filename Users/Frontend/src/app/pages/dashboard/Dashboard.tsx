import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, ImageOff, LibraryBig, MapPin, PackageCheck, PackagePlus, Search, SearchX, ShieldCheck, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { NavigationOptions, Page } from "@/app/types";
import type { User } from "@/app/utils/useAuth";
import { useAuth } from "@/app/utils/useAuth";
import { CX, SPRING } from "@/app/utils/clay";
import { ReportListSkeleton, SkeletonBlock } from "@/app/shared/LoadingSkeleton";

type Report = {
  id: string; item_name: string; category?: string; description?: string;
  location: string; date: string; image_url?: string; status: string;
  kind: "Found" | "Missing"; turnover_location?: string;
};
const PAGE_SIZE = 5;
const GRID_SIZE = 6;

function ReportImage({ report, className }: { report: Report; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!report.image_url || failed)
    return <div className={`${className} flex items-center justify-center bg-slate-100 text-slate-400`}><ImageOff size={22} aria-hidden="true" /></div>;
  return <img src={report.image_url} alt={report.item_name} loading="lazy" className={className} onError={() => setFailed(true)} />;
}

function StatusBadge({ report }: { report: Report }) {
  if (report.kind === "Found") return <span className={CX.badgeGold}><ShieldCheck size={13} aria-hidden="true" />In custody</span>;
  return <span className={CX.badgeTide}><Search size={13} aria-hidden="true" />{report.status === "missing" ? "Searching" : report.status}</span>;
}

export default function Dashboard({ user, onNavigate }: {
  user: User | null;
  onNavigate: (page: Page, options?: NavigationOptions) => void;
}) {
  const { searchFoundItems, getMissingItems } = useAuth();
  const [searchTerm,      setSearchTerm]      = useState("");
  const [foundReports,    setFoundReports]    = useState<Report[]>([]);
  const [missingReports,  setMissingReports]  = useState<Report[]>([]);
  const [reportsLoading,  setReportsLoading]  = useState(true);
  const [missingPage,     setMissingPage]     = useState(0);
  const [selected,        setSelected]        = useState<Report | null>(null);

  useEffect(() => {
    let active = true;
    setReportsLoading(true);
    void Promise.all([searchFoundItems({}), getMissingItems()]).then(([found, missing]) => {
      if (!active) return;
      setFoundReports((found.items || []).map((item: any) => ({
        id: item.fpost_id, item_name: item.item_name, category: item.category,
        description: item.description, location: item.location, date: item.found_date,
        image_url: item.image_url, status: item.status || "unclaimed",
        kind: "Found", turnover_location: item.turnover_location,
      })));
      setMissingReports((missing.items || []).map((item: any) => ({
        id: item.mpost_id, item_name: item.item_name, category: item.category,
        description: item.description, location: item.last_location, date: item.last_seen_date,
        image_url: item.image_url, status: item.status || "missing", kind: "Missing",
      })));
    }).finally(() => {
      if (active) setReportsLoading(false);
    });
    return () => { active = false; };
  }, [getMissingItems, searchFoundItems]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const firstName = user?.fname || "there";
  const totalMissingPages = Math.max(1, Math.ceil(missingReports.length / PAGE_SIZE));
  const safeMissingPage = Math.min(missingPage, totalMissingPages - 1);
  const visibleMissing = missingReports.slice(safeMissingPage * PAGE_SIZE, (safeMissingPage + 1) * PAGE_SIZE);
  const latestFound = foundReports.slice(0, GRID_SIZE);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const foundThisWeek = foundReports.filter((report) => report.date && new Date(report.date).getTime() >= weekAgo).length;

  function submitSearch(event?: React.FormEvent) {
    event?.preventDefault();
    onNavigate("missing-item", { searchTerm });
  }

  const actions = [
    { label: "I found an item", hint: "Log it and turn it over to security", page: "found-item" as Page, icon: <PackagePlus size={20} aria-hidden="true" />, tone: "bg-gold-500 text-navy-950" },
    { label: "I lost an item", hint: "Get matched against found reports", page: "missing-item" as Page, icon: <SearchX size={20} aria-hidden="true" />, tone: "bg-navy-800 text-white" },
    { label: "Browse everything", hint: "Public missing and in-custody lists", page: "browse-items" as Page, icon: <LibraryBig size={20} aria-hidden="true" />, tone: "bg-tide-600 text-white" },
  ];

  return (
    <main className={CX.page}>
      <div className={`${CX.inner} space-y-6`}>

        {/* ── Search hero ── */}
        <section className="overflow-hidden rounded-[var(--radius-card)] bg-navy-800 text-white shadow-raised">
          <div className="relative px-5 py-7 sm:px-8 md:py-9">
            <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-gold-500/10 blur-2xl" aria-hidden="true" />
            <p className="text-[13px] font-medium text-gold-300">Welcome back, {firstName}</p>
            <h1 className="mt-1 max-w-[22ch] font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.015em] md:text-[32px]">
              What are you looking for today?
            </h1>
            <form onSubmit={submitSearch} className="mt-5 flex max-w-[720px] flex-col gap-2 sm:flex-row" role="search">
              <label htmlFor="dashboard-search" className="sr-only">Search found items</label>
              <div className="relative flex-1">
                <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="dashboard-search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Try “blue backpack”, “calculator”, or “Library 3F”"
                  className="h-[52px] w-full rounded-[12px] border border-transparent bg-white pl-11 pr-4 text-[15px] text-ink outline-none placeholder:text-slate-400 focus:border-gold-400 focus:shadow-[0_0_0_4px_rgba(209,161,83,0.35)]"
                />
              </div>
              <button type="submit" className={`${CX.btnGold} h-[52px] px-6 text-[15px]`}>
                Search <ArrowRight size={16} aria-hidden="true" />
              </button>
            </form>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 bg-navy-900/60 sm:grid-cols-3">
            {[
              { label: "Items in custody", value: foundReports.length },
              { label: "Your active reports", value: missingReports.length },
              { label: "Found in the last 7 days", value: foundThisWeek, wide: true },
            ].map((stat) => (
              <div key={stat.label} className={`px-5 py-3.5 sm:px-8 ${stat.wide ? "hidden sm:block" : ""}`}>
                <dt className="text-[12px] text-navy-200">{stat.label}</dt>
                <dd className="mt-0.5 font-[family-name:var(--font-heading)] text-[20px] font-semibold tabular-nums">
                  {reportsLoading && typeof stat.value === "number" ? <SkeletonBlock className="mt-1 h-6 w-10 rounded" /> : stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Quick actions ── */}
        <section aria-label="Quick actions" className="grid gap-3 sm:grid-cols-3">
          {actions.map((action) => (
            <button
              key={action.page}
              type="button"
              onClick={() => onNavigate(action.page)}
              className={`${CX.cardHover} group flex items-center gap-4 p-4 text-left`}
            >
              <span className={`flex size-11 shrink-0 items-center justify-center rounded-[10px] ${action.tone}`}>{action.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink">{action.label}</span>
                <span className="block text-[13px] text-ink-muted">{action.hint}</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-navy-700" aria-hidden="true" />
            </button>
          ))}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* ── Latest found items ── */}
          <section className={`${CX.card} p-5 sm:p-6`} aria-labelledby="latest-found-heading">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className={CX.eyebrow}>In custody</p>
                <h2 id="latest-found-heading" className="mt-0.5 text-[19px] font-semibold text-ink">Latest found items</h2>
              </div>
              <button type="button" onClick={() => onNavigate("browse-items")} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[14px] font-semibold text-navy-700 hover:bg-navy-50">
                View all <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
            {reportsLoading ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="aspect-[4/3] w-full rounded-xl" />)}</div>
            ) : latestFound.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
                <PackageCheck size={28} className="text-slate-400" aria-hidden="true" />
                <p className="mt-2 text-[15px] font-semibold text-ink">Nothing in custody right now</p>
                <p className="mt-1 text-[14px] text-ink-muted">New found items appear here as soon as they are turned over.</p>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {latestFound.map((report) => (
                  <li key={report.id}>
                    <button type="button" onClick={() => setSelected(report)} className="group block w-full overflow-hidden rounded-xl border border-line bg-white text-left transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-raised">
                      <ReportImage report={report} className="aspect-[4/3] w-full object-cover" />
                      <div className="p-3">
                        <p className="truncate text-[14px] font-semibold text-ink group-hover:text-navy-700">{report.item_name}</p>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-ink-muted"><MapPin size={12} className="shrink-0" aria-hidden="true" />{report.location}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-muted tabular-nums"><CalendarDays size={12} className="shrink-0" aria-hidden="true" />{report.date}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Your missing reports ── */}
          <section className={`${CX.card} flex flex-col p-5 sm:p-6`} aria-labelledby="my-missing-heading">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className={CX.eyebrow}>Your reports</p>
                <h2 id="my-missing-heading" className="mt-0.5 text-[19px] font-semibold text-ink">Items you're looking for</h2>
              </div>
              <span className={CX.badgeNeutral}>{reportsLoading ? "…" : `${missingReports.length} active`}</span>
            </div>
            <div className="flex-1 space-y-2">
              {reportsLoading ? <ReportListSkeleton count={3} /> : visibleMissing.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
                  <SearchX size={28} className="text-slate-400" aria-hidden="true" />
                  <p className="mt-2 text-[15px] font-semibold text-ink">No missing reports yet</p>
                  <p className="mt-1 text-[14px] text-ink-muted">Report a lost item and we'll check every found item for matches.</p>
                  <button type="button" onClick={() => onNavigate("missing-item")} className={`${CX.btnGhost} mt-4`}>Report a lost item</button>
                </div>
              ) : visibleMissing.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => setSelected(report)}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-white p-2.5 text-left transition-colors hover:border-line-strong hover:bg-slate-50"
                >
                  <ReportImage report={report} className="size-14 shrink-0 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{report.item_name}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-ink-muted">{report.category || "Uncategorized"} · {report.location}</span>
                  </span>
                  <span className="font-mono text-[12px] text-ink-muted">{report.id}</span>
                </button>
              ))}
            </div>
            {totalMissingPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                <button type="button" onClick={() => setMissingPage(Math.max(0, safeMissingPage - 1))} disabled={safeMissingPage === 0} className={`${CX.btnSubtle} min-h-[36px] px-3 text-[13px]`}>
                  <ChevronLeft size={15} aria-hidden="true" /> Prev
                </button>
                <span className="text-[13px] text-ink-muted tabular-nums">Page {safeMissingPage + 1} of {totalMissingPages}</span>
                <button type="button" onClick={() => setMissingPage(Math.min(totalMissingPages - 1, safeMissingPage + 1))} disabled={safeMissingPage >= totalMissingPages - 1} className={`${CX.btnSubtle} min-h-[36px] px-3 text-[13px]`}>
                  Next <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            )}
            {missingReports.length > 0 && (
              <button type="button" onClick={() => onNavigate("matches")} className={`${CX.btnGhost} mt-4 w-full`}>
                Review possible matches <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </section>
        </div>

        {/* ── Item detail modal ── */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key="detail-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/55 p-0 backdrop-blur-[4px] sm:items-center sm:p-4"
              onClick={() => setSelected(null)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="dashboard-detail-title"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={SPRING}
                onClick={(e) => e.stopPropagation()}
                className="flex max-h-[92vh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-2xl border border-line bg-white shadow-overlay sm:rounded-2xl"
              >
                <div className="relative">
                  <ReportImage report={selected} className="h-[240px] w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label="Close details"
                    className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full bg-white/95 text-ink shadow-card hover:bg-white"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
                <div className="overflow-y-auto p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge report={selected} />
                    <span className="font-mono text-[12px] text-ink-muted">{selected.id}</span>
                  </div>
                  <h2 id="dashboard-detail-title" className="mt-2 font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-snug text-ink">{selected.item_name}</h2>
                  {selected.description && <p className="mt-2 whitespace-pre-line text-[15px] leading-6 text-ink-soft">{selected.description}</p>}
                  <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5">
                    {[
                      { label: "Category", value: selected.category || "Uncategorized" },
                      { label: selected.kind === "Found" ? "Found at" : "Last seen at", value: selected.location },
                      { label: selected.kind === "Found" ? "Date found" : "Date lost", value: selected.date },
                      ...(selected.turnover_location ? [{ label: "Held at", value: selected.turnover_location }] : []),
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <dt className="text-[12px] font-medium text-ink-muted">{label}</dt>
                        <dd className="mt-0.5 text-[15px] font-semibold text-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="flex flex-col-reverse gap-2 border-t border-line bg-slate-50/70 p-4 sm:flex-row sm:justify-end">
                  {selected.kind === "Missing" ? (
                    <button type="button" onClick={() => { onNavigate("matches", { reportId: selected.id }); setSelected(null); }} className={CX.btnNavy}>
                      See possible matches <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => { onNavigate("browse-items"); setSelected(null); }} className={CX.btnGhost}>Browse similar</button>
                      <button type="button" onClick={() => { onNavigate("claim", { foundItemId: selected.id }); setSelected(null); }} className={CX.btnGold}>
                        This is mine, start a claim <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </main>
  );
}
