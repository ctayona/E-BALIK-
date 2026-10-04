import { useEffect, useMemo, useState } from "react";
import { GitCompareArrows, ImageOff, Search, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "@/app/utils/useAuth";
import type { Page } from "@/app/types";
import { CX, SPRING } from "@/app/utils/clay";
import { ReportGridSkeleton, SkeletonBlock } from "@/app/shared/LoadingSkeleton";

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

export default function Matches({
  initialReportId = "",
  onNavigate,
}: {
  initialReportId?: string;
  onNavigate: (page: Page, options?: { foundItemId?: string; missingReportId?: string }) => void;
}) {
  // All logic preserved exactly
  const { getMissingItems, searchFoundItems } = useAuth();
  const [reports,   setReports]   = useState<MissingReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [selected,  setSelected]  = useState(initialReportId);
  const [matches,   setMatches]   = useState<Match[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [threshold, setThreshold] = useState("all");
  const [detail,    setDetail]    = useState<Match | null>(null);

  const report = reports.find((item) => item.mpost_id === selected);

  useEffect(() => {
    let active = true;
    setReportsLoading(true);
    void getMissingItems().then((result) => {
      if (!active) return;
      const items = (result.items || []) as MissingReport[];
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
      if (active) setMatches((result.items || []) as Match[]);
    }).finally(() => {
      if (active) setMatchesLoading(false);
    });
    return () => { active = false; };
  }, [report, searchFoundItems]);

  const visible = useMemo(
    () => matches.filter((item) =>
      threshold === "all" ||
      (threshold === "strong" ? item.match_percentage >= 75 : item.match_percentage >= 55)
    ),
    [matches, threshold],
  );

  const claySelect = `${CX.input} w-full pr-10 appearance-none`;

  return (
    <main className={CX.page}>
      <div className={CX.inner}>

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <span className={CX.sectionLabel}>Compare Reports</span>
          <h1 className="mt-1 text-[30px] font-semibold text-navy-800 tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            Matches
          </h1>
          <p className="mt-1 text-[14px] text-ink-muted max-w-[500px]">
            Compare your missing report with unclaimed found items using location, date, category, and description.
          </p>
        </motion.div>

        {/* Filter controls */}
        <div className={`${CX.card} p-5 mb-5`}>
          <div className="grid gap-3 md:grid-cols-[1fr_200px]">
            <div className="flex flex-col gap-2">
              <label htmlFor="matches-report" className={CX.label}>Your missing report</label>
              {reportsLoading ? <SkeletonBlock className="h-[44px] w-full rounded-xl" /> : <select
                id="matches-report"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className={claySelect}
              >
                <option value="">Select a missing report</option>
                {reports.map((item) => (
                  <option key={item.mpost_id} value={item.mpost_id}>
                    {item.mpost_id} · {item.item_name}
                  </option>
                ))}
              </select>}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="matches-threshold" className={CX.label}>Show</label>
              <select
                id="matches-threshold"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className={claySelect}
              >
                <option value="all">All matches</option>
                <option value="strong">Strong matches 75%+</option>
                <option value="possible">Possible matches 55%+</option>
              </select>
            </div>
          </div>
        </div>

        {/* Comparing banner */}
        {report && (
          <div className={`${CX.alertInfo} mb-5 flex items-center gap-2`}>
            <GitCompareArrows size={15} className="shrink-0 text-tide-600" aria-hidden="true" />
            <span>
              <strong className="text-navy-800">Comparing:</strong>{" "}
              {report.item_name} · {report.category} · {report.last_location} · {report.last_seen_date}
            </span>
          </div>
        )}

        {/* Match grid */}
        {matchesLoading || reportsLoading ? <ReportGridSkeleton count={4} /> : <div className="grid gap-4 md:grid-cols-2">
          {visible.length === 0 ? (
            <div className={`${CX.card} col-span-full py-16 text-center flex flex-col items-center gap-4`}>
              <div className="size-[60px] flex items-center justify-center rounded-[20px] bg-slate-100 border border-white/60 text-slate-500">
                <Search size={26} />
              </div>
              <p className="text-[15px] font-bold text-ink-muted">No matches in this confidence range.</p>
            </div>
          ) : visible.map((match, i) => (
            <motion.button
              type="button"
              key={match.fpost_id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: i * 0.06 }}
              onClick={() => setDetail(match)}
              className={`${CX.cardHover} group flex gap-4 p-4 text-left`}
            >
              {/* Thumbnail */}
              {match.image_url ? (
                <img
                  src={match.image_url}
                  alt={match.item_name}
                  className="size-[96px] shrink-0 rounded-[16px] object-cover border border-white/60"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              ) : (
                <div className="flex size-[96px] shrink-0 items-center justify-center rounded-[16px] bg-slate-100 text-slate-500 border border-white/60">
                  <ImageOff size={22} />
                </div>
              )}

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-[16px] font-semibold leading-snug text-ink group-hover:text-navy-700">{match.item_name}</h2>
                  <span className="shrink-0 font-mono text-[12px] text-ink-muted">{match.fpost_id}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-muted">
                  {match.category} · {match.location} · <span className="tabular-nums">{match.found_date}</span>
                </p>
                <MatchMeter pct={match.match_percentage} />
              </div>
            </motion.button>
          ))}
        </div>}

        {/* Match detail modal */}
        <AnimatePresence>
          {detail && (
            <motion.div
              key="detail-overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/55 px-4 backdrop-blur-[4px]"
              onClick={() => setDetail(null)}
            >
              <motion.div
                initial={{ scale: 0.88, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 16 }}
                transition={SPRING}
                onClick={(e) => e.stopPropagation()}
                className={`${CX.modal} w-full max-w-lg max-h-[90vh] overflow-y-auto gap-5
                            [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.5)_transparent]`}
              >
                {/* Close */}
                <button
                  type="button"
                  aria-label="Close match details"
                  onClick={() => setDetail(null)}
                  className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:text-navy-800 hover:bg-slate-100 transition-colors"
                >
                  <X size={18} />
                </button>

                {/* Image */}
                {detail.image_url && (
                  <div className="w-full rounded-2xl overflow-hidden border border-white/60">
                    <img src={detail.image_url} alt={detail.item_name} className="h-[200px] w-full object-cover" />
                  </div>
                )}

                {/* Header */}
                <div className="w-full">
                  <span className={CX.sectionLabel}>Match Comparison</span>
                  <h2 className="mt-2 text-[24px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>
                    {detail.item_name}
                  </h2>
                  <p className={`mt-2 text-[32px] font-semibold ${detail.match_percentage >= 75 ? "text-emerald-600" : detail.match_percentage >= 55 ? "text-amber-600" : "text-slate-500"}`}>
                    {detail.match_percentage}% match
                  </p>
                </div>

                <div className={CX.divider} />

                {/* Detail grid */}
                <div className="grid gap-3 md:grid-cols-2 w-full">
                  {[
                    { label: "Found Report ID",       value: detail.fpost_id },
                    { label: "Category & Location",   value: `${detail.category} · ${detail.location}` },
                    { label: "Found Date",             value: detail.found_date },
                    { label: "Description",            value: detail.description || "No description provided." },
                  ].map(({ label, value }) => (
                    <div key={label} className={`${CX.cardSm} p-3 ${label === "Description" ? "md:col-span-2" : ""}`}>
                      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-gold-700">{label}</p>
                      <p className="mt-1 text-[14px] font-semibold text-navy-800">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Claim CTA */}
                <motion.button
                  type="button"
                  whileHover={{ y: -2, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={SPRING}
                  onClick={() => {
                    setDetail(null);
                    onNavigate("claim", { foundItemId: detail.fpost_id, missingReportId: selected });
                  }}
                  className={`${CX.btnGold} w-full h-[52px] text-[15px]`}
                >
                  Claim this item
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </main>
  );
}

function MatchMeter({ pct }: { pct: number }) {
  const tier = pct >= 75
    ? { label: "Strong match", bar: "bg-emerald-600", text: "text-emerald-800" }
    : pct >= 55
      ? { label: "Possible match", bar: "bg-gold-500", text: "text-gold-800" }
      : { label: "Low confidence", bar: "bg-slate-400", text: "text-ink-muted" };
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[13px]">
        <span className={`font-semibold ${tier.text}`}>{tier.label}</span>
        <span className="font-semibold tabular-nums text-ink">{pct}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${tier.label}, ${pct} percent`}>
        <div className={`h-full rounded-full ${tier.bar}`} style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}
