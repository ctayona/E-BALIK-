import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, GitCompareArrows, MapPin, Search, SearchX, ShieldCheck } from "lucide-react";
import { useAuth } from "@/app/utils/useAuth";
import { isCompletedReport } from "@/app/utils/reportLifecycle";
import type { Page } from "@/app/types";
import { CX } from "@/app/utils/clay";
import { ReportGridSkeleton, SkeletonBlock } from "@/app/shared/LoadingSkeleton";
import ItemCollection from "@/app/shared/media/ItemCollection";
import ItemImage, { type GalleryItem } from "@/app/shared/media/ItemImage";
import ViewToggle from "@/app/shared/view/ViewToggle";
import { useViewMode } from "@/app/shared/view/useViewMode";
import Modal from "@/app/shared/modal/Modal";

type MissingReport = {
  mpost_id: string; item_name: string; category: string;
  last_location: string; last_seen_date: string;
  image_url?: string; description?: string;
};
type Match = {
  fpost_id: string; item_name: string; category: string;
  location: string; found_date: string; image_url?: string;
  description?: string; match_percentage: number;
};
type Threshold = "all" | "strong" | "possible";

const tierOf = (pct: number) => pct >= 75
  ? { label: "Strong match", short: "Strong", bar: "bg-emerald-500", text: "text-emerald-700", ring: "#10b981", chip: "bg-emerald-50 text-emerald-800 ring-emerald-200" }
  : pct >= 55
    ? { label: "Possible match", short: "Possible", bar: "bg-gold-500", text: "text-gold-800", ring: "#d1a153", chip: "bg-gold-50 text-gold-800 ring-gold-200" }
    : { label: "Low confidence", short: "Low", bar: "bg-slate-400", text: "text-ink-muted", ring: "#94a3b8", chip: "bg-white/95 text-ink-soft ring-line" };

const matchToGallery = (match: Match): GalleryItem => ({
  id: match.fpost_id, title: match.item_name, kind: "found", image: match.image_url || undefined,
  category: match.category, location: match.location, date: match.found_date, description: match.description,
});

export default function Matches({
  initialReportId = "",
  onNavigate,
}: {
  initialReportId?: string;
  onNavigate: (page: Page, options?: { foundItemId?: string; missingReportId?: string }) => void;
}) {
  const { getMissingItems, searchFoundItems } = useAuth();
  const [mode] = useViewMode();
  const [reports, setReports] = useState<MissingReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [selected, setSelected] = useState(initialReportId);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [threshold, setThreshold] = useState<Threshold>("all");
  const [detail, setDetail] = useState<Match | null>(null);

  const report = reports.find((item) => item.mpost_id === selected);

  useEffect(() => {
    let active = true;
    setReportsLoading(true);
    void getMissingItems().then((result) => {
      if (!active) return;
      // A completed report (the item was already released to you) has nothing left to match.
      const items = ((result.items || []) as MissingReport[]).filter((item) => !isCompletedReport("Missing", (item as { status?: string }).status));
      setReports(items);
      if (initialReportId && items.some((item) => item.mpost_id === initialReportId)) setSelected(initialReportId);
      else if (items[0]) setSelected(items[0].mpost_id);
    }).finally(() => {
      if (active) setReportsLoading(false);
    });
    return () => { active = false; };
  }, [getMissingItems, initialReportId]);

  useEffect(() => {
    if (!report) {
      setMatches([]);
      setMatchesLoading(false);
      return;
    }
    let active = true;
    setMatchesLoading(true);
    void searchFoundItems({
      missing_item_name: report.item_name,
      missing_category: report.category,
      missing_description: report.description || "",
      missing_location: report.last_location,
      missing_date: report.last_seen_date,
    }).then((result) => {
      if (active) setMatches(((result.items || []) as Match[]).sort((a, b) => b.match_percentage - a.match_percentage));
    }).finally(() => {
      if (active) setMatchesLoading(false);
    });
    return () => { active = false; };
  }, [report, searchFoundItems]);

  const counts = useMemo(() => ({
    all: matches.length,
    strong: matches.filter((m) => m.match_percentage >= 75).length,
    possible: matches.filter((m) => m.match_percentage >= 55).length,
  }), [matches]);

  const visible = useMemo(
    () => matches.filter((item) => threshold === "all" || (threshold === "strong" ? item.match_percentage >= 75 : item.match_percentage >= 55)),
    [matches, threshold],
  );
  const visibleGallery = useMemo(() => visible.map(matchToGallery), [visible]);
  const reportGallery: GalleryItem | null = report ? {
    id: report.mpost_id, title: report.item_name, kind: "missing", image: report.image_url || undefined,
    category: report.category, location: report.last_location, date: report.last_seen_date, description: report.description,
  } : null;

  return (
    <main className={CX.page}>
      <div className={CX.inner}>
        <header className="mb-6">
          <p className={CX.eyebrow}>Compare reports</p>
          <h1 className={`${CX.pageTitle} mt-1`}>Matches</h1>
          <p className={CX.pageLead}>We score every unclaimed found item against your missing report by category, place, date and description.</p>
        </header>

        {/* Report selector */}
        <section className={`${CX.card} mb-5 overflow-hidden`} aria-label="Report to compare">
          <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="flex items-center gap-4 border-b border-line p-4 sm:p-5 md:border-b-0 md:border-r">
              {reportsLoading ? <SkeletonBlock className="size-20 shrink-0 rounded-2xl" /> : reportGallery ? (
                <ItemImage item={reportGallery} size="sm" className="size-20 shrink-0 rounded-2xl" />
              ) : (
                <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-frost-100 text-iris-600"><SearchX size={26} aria-hidden="true" /></span>
              )}
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-tide-700">Comparing</p>
                <p className="truncate font-[family-name:var(--font-heading)] text-[19px] font-semibold text-ink">{report?.item_name || (reportsLoading ? "Loading your reports…" : "No missing report selected")}</p>
                {report && (
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-ink-muted">
                    <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden="true" />{report.last_location}</span>
                    <span className="inline-flex items-center gap-1 tabular-nums"><CalendarDays size={13} aria-hidden="true" />{report.last_seen_date}</span>
                  </p>
                )}
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <label htmlFor="matches-report" className={CX.label}>Your missing report</label>
              {reportsLoading ? <SkeletonBlock className="h-[44px] w-full rounded-xl" /> : reports.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong bg-frost-50 p-3 text-[14px] text-ink-muted">
                  You haven't reported a lost item yet.
                  <button type="button" onClick={() => onNavigate("missing-item")} className={CX.btnNavy}>Report a lost item</button>
                </div>
              ) : (
                <div className="relative">
                  <select id="matches-report" value={selected} onChange={(e) => setSelected(e.target.value)} className={`${CX.input} w-full appearance-none pr-10`}>
                    {reports.map((item) => <option key={item.mpost_id} value={item.mpost_id}>{item.mpost_id} · {item.item_name}</option>)}
                  </select>
                  <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Threshold + view */}
        <div className="glass sticky top-[calc(76px+env(safe-area-inset-top))] z-20 mb-5 flex items-center justify-between gap-2 rounded-[20px] p-2">
          <div role="tablist" aria-label="Match confidence" className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
            {([["all", "All"], ["strong", "Strong 75%+"], ["possible", "Possible 55%+"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={threshold === value}
                onClick={() => setThreshold(value)}
                className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[14px] font-semibold transition-colors ${
                  threshold === value ? "bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] text-white shadow-[0_8px_18px_-10px_rgba(17,27,66,0.8)]" : "text-ink-soft hover:bg-white/80"
                }`}
              >
                {label}
                <span className={`rounded-full px-1.5 text-[12px] tabular-nums ${threshold === value ? "bg-white/20" : "bg-frost-100 text-ink-muted"}`}>{counts[value]}</span>
              </button>
            ))}
          </div>
          <ViewToggle compact />
        </div>

        {matchesLoading || reportsLoading ? <ReportGridSkeleton count={4} /> : (
          <ItemCollection
            label="Possible matches"
            items={visibleGallery}
            mode={mode}
            showKind={false}
            onOpen={(_item, index) => setDetail(visible[index])}
            badge={(_item, index) => {
              const tier = tierOf(visible[index].match_percentage);
              return <span className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums ring-1 ${tier.chip}`}>{visible[index].match_percentage}%</span>;
            }}
            extra={(_item, index) => <MatchMeter pct={visible[index].match_percentage} />}
            empty={
              <div className="glass flex flex-col items-center gap-3 rounded-[22px] px-6 py-14 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-frost-100 text-iris-600"><Search size={26} aria-hidden="true" /></span>
                <p className="text-[16px] font-semibold text-ink">{report ? "No matches in this confidence range" : "Choose a missing report to see matches"}</p>
                <p className="max-w-[46ch] text-[14px] text-ink-muted">New found items are scored as soon as they're reported, so check back soon.</p>
              </div>
            }
          />
        )}
      </div>

      {/* Comparison modal */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        size="xl"
        tone="iris"
        icon={<GitCompareArrows size={21} />}
        eyebrow="Match comparison"
        title={detail?.item_name}
        description={detail ? `${tierOf(detail.match_percentage).label} for your report ${selected}.` : undefined}
        footer={detail && (
          <>
            <button type="button" onClick={() => setDetail(null)} className={CX.btnGhost}>Not mine</button>
            <button
              type="button"
              onClick={() => { const id = detail.fpost_id; setDetail(null); onNavigate("claim", { foundItemId: id, missingReportId: selected }); }}
              className={CX.btnGold}
            >
              This is mine, start a claim <ArrowRight size={16} aria-hidden="true" />
            </button>
          </>
        )}
      >
        {detail && reportGallery && (
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-2xl border border-line bg-frost-50 p-4">
              <ScoreRing pct={detail.match_percentage} />
              <div className="min-w-0 flex-1">
                <p className={`text-[15px] font-semibold ${tierOf(detail.match_percentage).text}`}>{tierOf(detail.match_percentage).label}</p>
                <p className="text-[14px] text-ink-muted">Based on category, location, date and description similarity. Always verify distinctive marks before claiming.</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { heading: "Your missing report", tone: "text-tide-700", icon: SearchX, item: reportGallery },
                { heading: "Found item in custody", tone: "text-gold-700", icon: ShieldCheck, item: matchToGallery(detail) },
              ].map(({ heading, tone, icon: Icon, item }) => (
                <article key={heading} className="overflow-hidden rounded-[22px] border border-line bg-white shadow-card">
                  <ItemImage item={item} className="aspect-[16/10] w-full" />
                  <div className="p-4">
                    <p className={`flex items-center gap-1.5 text-[12px] font-semibold ${tone}`}><Icon size={13} aria-hidden="true" />{heading}</p>
                    <p className="mt-1 font-[family-name:var(--font-heading)] text-[18px] font-semibold text-ink">{item.title}</p>
                    <dl className="mt-3 space-y-2 text-[14px]">
                      {[["Category", item.category], ["Place", item.location], ["Date", item.date], ["Reference", item.id]].map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0">
                          <dt className="text-ink-muted">{label}</dt>
                          <dd className={`text-right font-semibold text-ink ${label === "Reference" ? "font-mono text-[13px]" : ""}`}>{value || "Not recorded"}</dd>
                        </div>
                      ))}
                    </dl>
                    {item.description && <p className="mt-3 line-clamp-4 text-[14px] leading-6 text-ink-soft">{item.description}</p>}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </main>
  );
}

function MatchMeter({ pct }: { pct: number }) {
  const tier = tierOf(pct);
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] sm:text-[13px]">
        <span className={`font-semibold ${tier.text}`}>{tier.label}</span>
        <span className="font-semibold tabular-nums text-ink">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${tier.label}, ${pct} percent`}>
        <div className={`h-full rounded-full ${tier.bar}`} style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

function ScoreRing({ pct }: { pct: number }) {
  const tier = tierOf(pct);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative size-[68px] shrink-0" role="img" aria-label={`${pct} percent match`}>
      <svg viewBox="0 0 64 64" className="size-full -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#e3e8f0" strokeWidth="7" />
        <circle cx="32" cy="32" r={radius} fill="none" stroke={tier.ring} strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, pct) / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-[family-name:var(--font-heading)] text-[17px] font-semibold tabular-nums text-ink">{pct}%</span>
    </div>
  );
}
