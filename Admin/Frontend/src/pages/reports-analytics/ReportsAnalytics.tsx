import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Sparkles, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import {
  fetchAdminReports,
  reportAdminProcess,
  type AdminDashboardSummary,
} from "../../utils/api";
import { AdminMetricSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import { T } from "../../components/ui/management";

import { tr } from "../../utils/preferences";
const categoryColors = ["#1f3160", "#d1a153", "#0f8077", "#6a84b8", "#b45309", "#94a3b8"];
const claimColors = ["#d97706", "#2563eb", "#dc2626", "#059669", "#64748b"];

export default function ReportsAnalytics() {
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [chartData, setChartData] = useState<Array<{ month: string; lost: number; found: number }>>([]);
  const [categoryData, setCategoryData] = useState<Array<{ name: string; value: number; color: string }>>([]);
  const [locationData, setLocationData] = useState<Array<{ location: string; lost: number; found: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [periodMonths, setPeriodMonths] = useState<3 | 6 | 12>(12);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    setLoading(true);
    fetchAdminReports()
      .then((data) => {
        if (!active) return;

        setSummary(data.summary);
        setChartData(data.summary.chart_data?.length ? data.summary.chart_data : []);
        setLoadError("");

        setCategoryData(data.categories.slice(0, 6).map((item, index) => ({ ...item, color: categoryColors[index % categoryColors.length] })));
        setLocationData(data.locations.slice(0, 6));
      })
      .catch(() => {
        if (active) setLoadError(tr("Analytics data could not be loaded. Check your connection and try again."));
        setSummary(null);
        setChartData([]);
        setCategoryData([]);
        setLocationData([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [refreshKey]);

  const exportReport = () => window.print();

  const claimCounts = summary?.claim_status_counts ?? {};
  const claimStatusData = Object.entries(claimCounts).map(([name, value], index) => ({
    name,
    value,
    color: claimColors[index % claimColors.length],
  }));
  const visibleChartData = chartData.slice(-periodMonths);
  const aiAcceptanceRate = summary?.ai_decided
    ? ((summary.ai_confirmed ?? 0) / summary.ai_decided) * 100
    : 0;

  const exportCsv = () => {
    const rows = [
      ["Section", "Measure", "Value"],
      ["Summary", "Recovery rate", `${summary?.recovery_rate ?? 0}%`],
      ["Summary", "Average resolution days", summary?.average_resolution_days == null ? "Not available" : String(summary.average_resolution_days)],
      ["Summary", "Claim approval rate", `${summary?.claim_approval_rate ?? 0}%`],
      ["Summary", "AI decision acceptance", `${aiAcceptanceRate.toFixed(1)}%`],
      ...visibleChartData.map((row) => ["Monthly trend", row.month, `Lost: ${row.lost}; Found: ${row.found}`]),
      ...categoryData.map((row) => ["Category", row.name, String(row.value)]),
      ...locationData.map((row) => ["Location", row.location, `Lost: ${row.lost}; Found: ${row.found}`]),
      ...Object.entries(claimCounts).map(([name, count]) => ["Claim status", name, String(count)]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ebalik-admin-analytics.csv";
    link.click();
    URL.revokeObjectURL(url);
    reportAdminProcess({ success: true, title: "Export analytics", message: "The report data was exported to CSV." });
  };

  const kpis = summary ? [
    { label: tr("Recovery Rate"), value: `${summary.recovery_rate ?? 0}%`, delta: tr("{0} returned of {1} found", { "0": summary.successfully_returned, "1": summary.found_items }), icon: <TrendingUp size={18} aria-hidden="true" />, color: "#0f8077", bg: "#ecfaf8" },
    { label: tr("Average Resolution"), value: summary.average_resolution_days == null ? "N/A" : `${summary.average_resolution_days} d`, delta: tr("{0} collected claims measured", { "0": summary.collected_claims ?? 0 }), icon: <Clock3 size={18} aria-hidden="true" />, color: "#1f3160", bg: "#f2f5fb" },
    { label: tr("AI Decision Acceptance"), value: `${aiAcceptanceRate.toFixed(1)}%`, delta: tr("{0} confirmed of {1} decisions", { "0": summary.ai_confirmed ?? 0, "1": summary.ai_decided ?? 0 }), icon: <Sparkles size={18} aria-hidden="true" />, color: "#8f6526", bg: "#fdf8ee" },
    { label: tr("Claim Approval Rate"), value: `${summary.claim_approval_rate ?? 0}%`, delta: tr("{0} awaiting review", { "0": summary.pending_claims }), icon: <CheckCircle2 size={18} aria-hidden="true" />, color: "#047857", bg: "#ecfdf5" },
  ] : [
    { label: tr("Recovery Rate"), value: "N/A", delta: tr("Waiting for data"), icon: <TrendingUp size={18} aria-hidden="true" />, color: "#0f8077", bg: "#ecfaf8" },
    { label: tr("Average Resolution"), value: "N/A", delta: tr("Waiting for data"), icon: <Clock3 size={18} aria-hidden="true" />, color: "#1f3160", bg: "#f2f5fb" },
    { label: tr("AI Decision Acceptance"), value: "N/A", delta: tr("Waiting for data"), icon: <Sparkles size={18} aria-hidden="true" />, color: "#8f6526", bg: "#fdf8ee" },
    { label: tr("Claim Approval Rate"), value: "N/A", delta: tr("Waiting for data"), icon: <CheckCircle2 size={18} aria-hidden="true" />, color: "#047857", bg: "#ecfdf5" },
  ];

  const maxLocationValue = Math.max(1, ...locationData.flatMap(loc => [loc.lost, loc.found]));

  return (
    <div className="print-report print-compact p-6 space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
        <h1 className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]"><T k="page.reports" /></h1>
        <p className="mt-1 max-w-[68ch] text-[14px] leading-6 text-ink-muted">{tr("Live system performance and item recovery measurements")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-white p-1" aria-label={tr("Trend reporting period")}>
            {([3, 6, 12] as const).map((months) => <button key={months} onClick={() => setPeriodMonths(months)} aria-pressed={periodMonths === months} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${periodMonths === months ? "bg-navy-800 text-white" : "text-slate-600 hover:bg-navy-50"}`}>{tr("{0} mo", { "0": months })}</button>)}
          </div>
          <button onClick={() => setRefreshKey((current) => current + 1)} disabled={loading} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-navy-50 disabled:opacity-50">{loading ? tr("Refreshing...") : tr("Refresh")}</button>
        </div>
      </div>

      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{loadError}</span><button onClick={() => setRefreshKey((current) => current + 1)} className="font-semibold underline">{tr("Retry")}</button></div>}

      {loading ? (
        <div className="space-y-5" aria-busy="true"><AdminMetricSkeleton count={4} /><div className="grid grid-cols-1 gap-4 xl:grid-cols-3"><SkeletonBlock className="h-[300px] rounded-xl bg-white" /><SkeletonBlock className="h-[300px] rounded-xl bg-white" /></div></div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {kpis.map(k => (
              <div key={k.label} className="bg-white rounded-2xl border border-line shadow-card p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex size-10 items-center justify-center rounded-xl" style={{ background: k.bg, color: k.color }}>{k.icon}</div>
                </div>
                <div className="text-3xl font-bold text-slate-900 mb-0.5">{k.value}</div>
                <div className="text-xs text-slate-500 mb-1">{k.label}</div>
                <div className="text-xs font-semibold" style={{ color: k.delta.startsWith("-") ? "#ef4444" : k.color }}>{k.delta}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 bg-white rounded-2xl border border-line shadow-card p-5">
              <div className="font-bold text-slate-900 mb-0.5">{tr("Lost and found trends")}</div>
              <div className="text-xs text-slate-400 mb-4">{tr("Monthly comparison for the last {0} months", { "0": periodMonths })}</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={visibleChartData.length ? visibleChartData : [{ month: tr("No data"), lost: 0, found: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                  <Tooltip contentStyle={{ border: "none", borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", fontSize: 13 }} />
                  <Line type="monotone" dataKey="lost" stroke="#1f3160" strokeWidth={2.5} dot={{ fill: "#1f3160", r: 4 }} name="Lost" />
                  <Line type="monotone" dataKey="found" stroke="#0f8077" strokeWidth={2.5} dot={{ fill: "#0f8077", r: 4 }} name="Found" />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-5 mt-3 text-xs">
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 inline-block rounded" style={{ background: "#0f8077" }}></span>{tr("Found")}</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 inline-block rounded" style={{ background: "#1f3160" }}></span>{tr("Lost")}</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-line shadow-card p-5">
              <div className="font-bold text-slate-900 mb-0.5">{tr("Items by Category")}</div>
              <div className="text-xs text-slate-400 mb-2">{tr("Distribution of lost/found reports")}</div>
              {categoryData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={categoryData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                        {categoryData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ border: "none", borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {categoryData.map(c => (
                      <div key={c.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }}></div>
                          <span className="text-slate-600">{c.name}</span>
                        </div>
                        <span className="font-semibold text-slate-800">{c.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-400 pt-10 text-center">{tr("No category data available yet")}</div>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
              <div className="font-bold text-slate-900">{tr("Claims by Status")}</div>
              <div className="mb-2 text-xs text-slate-400">{tr("Current distribution across {0} claims", { "0": Object.values(claimCounts).reduce((total, count) => total + count, 0) })}</div>
              {claimStatusData.length ? <>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={claimStatusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                      {claimStatusData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ border: "none", borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {claimStatusData.map((entry) => <div key={entry.name} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-slate-600"><span className="size-2.5 rounded-full" style={{ background: entry.color }} />{entry.name}</span><span className="font-semibold text-slate-800">{entry.value}</span></div>)}
                </div>
              </> : <div className="py-16 text-center text-sm text-slate-400">{tr("No claim records available")}</div>}
            </div>
            <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
              <div className="font-bold text-slate-900">{tr("Operational Summary")}</div>
              <div className="mb-4 text-xs text-slate-400">{tr("Counts and rates from current database records")}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Total users", String(summary?.total_users ?? 0)],
                  ["Lost reports", String(summary?.total_lost_reports ?? 0)],
                  ["Found records", String(summary?.found_items ?? 0)],
                  ["Open AI matches", String(summary?.potential_ai_matches ?? 0)],
                  ["Pending claims", String(summary?.pending_claims ?? 0)],
                  ["Unresolved found items", String(summary?.unresolved_items ?? 0)],
                  ["Reviewed claims", String(summary?.reviewed_claims ?? 0)],
                  ["Reports dated this month", String(summary?.current_month_processed ?? 0)],
                ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm"><span className="text-slate-600">{tr(label)}</span><span className="font-bold tabular-nums text-slate-900">{value}</span></div>)}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-line shadow-card p-5">
            <div className="font-bold text-slate-900 mb-1">{tr("Items by Location")}</div>
            <div className="text-xs text-slate-400 mb-4">{tr("Campus hotspots for lost and found incidents")}</div>
            {locationData.length > 0 ? (
              <div className="space-y-3">
                {locationData.map(loc => (
                  <div key={loc.location} className="flex items-center gap-4">
                    <div className="w-28 text-sm text-slate-600 flex-shrink-0">{loc.location}</div>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(loc.lost / maxLocationValue) * 100}%`, background: "#1f3160" }} />
                      </div>
                      <span className="text-xs text-slate-500 w-6 text-right">{loc.lost}</span>
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(loc.found / maxLocationValue) * 100}%`, background: "#0f8077" }} />
                      </div>
                      <span className="text-xs text-slate-500 w-6 text-right">{loc.found}</span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                  <div className="w-28"></div>
                  <div className="flex-1 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#1f3160" }}></span>{tr("Lost")}</div>
                  <div className="flex-1 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#0f8077" }}></span>{tr("Found")}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-400 text-center py-8">{tr("No location records available yet")}</div>
            )}
          </div>

          <div className="print-hide flex flex-wrap justify-center gap-3">
            <button onClick={exportCsv} className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-white px-5 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-navy-50 sm:w-auto">
              {tr("Export CSV")}
            </button>
            <button onClick={exportReport} className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 sm:w-auto" style={{ background: "#0d2044" }}>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {tr("Export reports and analytics (PDF)")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
