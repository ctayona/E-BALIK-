import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Download, MapPin, Printer, RefreshCw } from "lucide-react";
import { fetchDashboardAnalytics, type AnalyticsQuery, type DashboardAnalytics } from "../../utils/api";
import { downloadCsv } from "../../utils/csv";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { BTN, INPUT } from "../../components/ui/primitives";
import { useTheme, tr } from "../../utils/preferences";

/** Fixed categorical order, validated for colour-blind separation (light and dark surfaces). Slices never get a generated hue: the rest fold into "Other". */
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"],
};
// One hue, light to dark, for magnitude. Dark mode never goes darker than step 600 so every cell stays visible on the surface.
const RAMP = {
  light: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#104281"],
  dark: ["#184f95", "#1c5cab", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"],
};
const TONE = {
  light: { grid: "#e1e0d9", tick: "#898781", empty: "#f0efec", surface: "#fcfcfb", other: "#898781", bar: "#2a78d6", tooltip: { background: "#ffffff", border: "1px solid #e3e8f0", color: "#0f172a" } },
  dark: { grid: "#2c2c2a", tick: "#a6a9b8", empty: "#2c2c2a", surface: "#1a1a19", other: "#898781", bar: "#3987e5", tooltip: { background: "#0f172f", border: "1px solid rgba(255,255,255,0.1)", color: "#eef1f8" } },
};
const GOLD = "#d1a153";

type RangeKey = "30d" | "90d" | "12m" | "all" | "custom";
const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "30d", label: "30 days" }, { key: "90d", label: "90 days" }, { key: "12m", label: "12 months" }, { key: "all", label: "All time" }, { key: "custom", label: "Custom" },
];

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%");
const describeRange = (data: DashboardAnalytics) => (data.range.key === "all" ? tr("All time") : `${data.range.start ?? ""} to ${data.range.end ?? ""}`);

/** One flat CSV of every figure on screen: Section, Item, Value, Detail. */
function exportCsv(data: DashboardAnalytics) {
  const rows: Array<Array<string | number>> = [
    ["Range", data.range.key, describeRange(data), ""],
    ["Lost reports", "Total", data.lost_total, ""],
    ...data.lost_categories.map((c): Array<string | number> => ["Lost category", c.name, c.value, pct(c.value, data.lost_total)]),
    ...data.lost_by_weekday.map((d): Array<string | number> => ["Lost by weekday", d.name, d.count, ""]),
    ...data.lost_by_month.map((m): Array<string | number> => ["Lost by month", m.month, m.count, ""]),
    ...data.hotspots.map((h): Array<string | number> => ["Hotspot", h.location, h.total, `lost ${h.lost}, found ${h.found}`]),
    ["Found items", "Returned to owners", data.outcomes.returned, `${data.outcomes.return_rate}% of found items`],
    ["Found items", "Auctioned", data.outcomes.auctioned, ""],
    ["Found items", "Abandoned or disposed", data.outcomes.abandoned, ""],
    ["Found items", "Still in custody", data.outcomes.in_custody, ""],
    ["Found items", "Total found", data.outcomes.total_found, ""],
  ];
  downloadCsv(`analytics-${data.range.key}`, ["Section", "Item", "Value", "Detail"], rows);
}

const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));

/** Opens a clean printable report (tables, no charts) and the print dialog, where "Save as PDF" is one of the choices. */
function printReport(data: DashboardAnalytics) {
  const table = (title: string, head: string[], body: Array<Array<string | number>>) => body.length === 0 ? "" :
    `<h2>${escapeHtml(title)}</h2><table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>E-Balik analytics report</title><style>
    body{font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;margin:32px}h1{font-family:Georgia,serif;color:#1f3160;margin:0}
    p.meta{color:#475569;margin:4px 0 20px}h2{font-size:15px;color:#1f3160;border-bottom:2px solid #d1a153;padding-bottom:4px;margin:24px 0 8px}
    table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #e2e8f0}th{background:#f1f5f9}
    @media print{body{margin:12mm}}</style></head><body>
    <h1>E-Balik analytics report</h1>
    <p class="meta">University of Makati Lost and Found. Period: ${escapeHtml(describeRange(data))}. Created ${escapeHtml(new Date().toLocaleString())}.</p>
    ${table("Found items: how they ended up", ["Outcome", "Items"], [["Returned to owners", data.outcomes.returned], ["Auctioned", data.outcomes.auctioned], ["Abandoned or disposed", data.outcomes.abandoned], ["Still in custody", data.outcomes.in_custody], ["Total found", data.outcomes.total_found], ["Return rate", `${data.outcomes.return_rate}%`]])}
    ${table(`Most lost item categories (${data.lost_total} lost reports)`, ["Category", "Reports", "Share"], data.lost_categories.map((c) => [c.name, c.value, pct(c.value, data.lost_total)]))}
    ${table("Busiest days", ["Day", "Lost reports"], data.lost_by_weekday.map((d) => [d.name, d.count]))}
    ${table("Busiest months", ["Month", "Lost reports"], data.lost_by_month.map((m) => [m.month, m.count]))}
    ${table("Campus hotspots", ["Location", "Lost", "Found", "Total"], data.hotspots.map((h) => [h.location, h.lost, h.found, h.total]))}
    </body></html>`;
  const popup = window.open("", "_blank");
  if (!popup) { showInfoModal({ variant: "warning", title: "Pop-up blocked", message: "Allow pop-ups for this site, then press Print report again." }); return; }
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 300);
}

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`admin-card p-5 sm:p-6 ${className}`}>
      <h3 className="font-[family-name:var(--font-heading)] text-[18px] font-semibold text-ink">{title}</h3>
      <p className="mb-4 text-[13px] text-ink-muted">{subtitle}</p>
      {children}
    </section>
  );
}

/** The same numbers as text, for screen readers and for anyone who wants the exact values. */
function AsTable({ label, headers, rows }: { label: string; headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="mt-3 text-[13px] text-ink-muted">
      <summary className="cursor-pointer select-none font-semibold text-ink-soft">{label}</summary>
      <table className="mt-2 w-full text-left">
        <thead><tr>{headers.map((header) => <th key={header} className="border-b border-line py-1.5 pr-3 font-semibold text-ink-soft">{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-line/60 py-1.5 pr-3 tabular-nums">{cell}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

function Tile({ label, value, hint, color }: { label: string; value: number; hint: string; color: string }) {
  return (
    <div className="rounded-2xl border border-line px-4 py-3.5">
      <dt className="flex items-center gap-2 text-[13px] font-medium text-ink-muted"><span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />{label}</dt>
      <dd className="mt-1 font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-none tabular-nums text-ink">{value.toLocaleString()}</dd>
      <p className="mt-1.5 text-[12.5px] text-ink-muted">{hint}</p>
    </div>
  );
}

export default function AnalyticsSection() {
  const [theme] = useTheme();
  const mode = theme === "dark" ? "dark" : "light";
  const tone = TONE[mode];
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hover, setHover] = useState<{ label: string; count: number } | null>(null);
  const [rangeKey, setRangeKey] = useState<RangeKey>("12m");
  const [draft, setDraft] = useState({ start: "", end: "" });
  const [applied, setApplied] = useState<{ start: string; end: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [customError, setCustomError] = useState("");

  const query = useMemo<AnalyticsQuery | null>(() => (rangeKey === "custom" ? (applied ? { start: applied.start, end: applied.end } : null) : { range: rangeKey }), [rangeKey, applied]);
  useEffect(() => {
    if (!query) return undefined;   // custom range chosen, dates not applied yet
    let active = true;
    setRefreshing(true); setError("");
    fetchDashboardAnalytics(query)
      .then((next) => { if (active) setData(next); })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : tr("Unable to load analytics")); })
      .finally(() => { if (active) { setRefreshing(false); setLoading(false); } });
    return () => { active = false; };
  }, [query, reload]);
  const load = () => setReload((n) => n + 1);

  const applyCustom = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.start || !draft.end) { setCustomError(tr("Choose both dates.")); return; }
    if (draft.start > draft.end) { setCustomError(tr("The start date must be before the end date.")); return; }
    setCustomError("");
    setApplied({ ...draft });
  };

  const slices = useMemo(() => (data?.lost_categories ?? []).map((entry, index) => ({ ...entry, color: entry.name === "Other" ? tone.other : SERIES[mode][index % SERIES[mode].length] })), [data, mode, tone.other]);
  const slicesTotal = slices.reduce((sum, slice) => sum + slice.value, 0);
  const cellColor = (count: number, max: number) => (count <= 0 ? tone.empty : RAMP[mode][Math.min(RAMP[mode].length - 1, Math.floor((count / Math.max(max, 1)) * (RAMP[mode].length - 1) + 0.5))]);

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <SkeletonBlock className="h-8 w-64" />
        <div className="grid gap-5 lg:grid-cols-2"><SkeletonBlock className="h-[300px] w-full" /><SkeletonBlock className="h-[300px] w-full" /></div>
      </div>
    );
  }
  if (!data) {
    return (
      <section className="admin-card flex flex-wrap items-center justify-between gap-3 p-5" role="alert">
        <p className="text-[14px] text-ink-soft">{error || tr("Analytics are not available right now.")}</p>
        <button type="button" onClick={load} className={BTN.ghost}><RefreshCw size={15} aria-hidden="true" />{tr("Try again")}</button>
      </section>
    );
  }

  const { outcomes, busiest, lost_heatmap: heat } = data;
  const closedTotal = outcomes.returned + outcomes.auctioned + outcomes.abandoned;
  const outcomeBars = [
    { key: "returned", label: tr("Returned to owners"), value: outcomes.returned, color: SERIES[mode][2] },
    { key: "auctioned", label: tr("Auctioned"), value: outcomes.auctioned, color: SERIES[mode][0] },
    { key: "abandoned", label: tr("Abandoned or disposed"), value: outcomes.abandoned, color: SERIES[mode][1] },
    { key: "custody", label: tr("Still in custody"), value: outcomes.in_custody, color: tone.other },
  ];
  const noLost = data.lost_total === 0;

  return (
    <div className="space-y-5" aria-labelledby="analytics-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="analytics-heading" className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-[22px] font-semibold text-ink"><BarChart3 size={21} className="text-gold-600" aria-hidden="true" />{tr("Visual analytics")}</h2>
          <p className="text-[13px] text-ink-muted">{tr("What gets lost, when it gets lost, and how items end up.")} {describeRange(data)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => exportCsv(data)} className={BTN.ghost}><Download size={15} aria-hidden="true" />{tr("Export CSV")}</button>
          <button type="button" onClick={() => printReport(data)} className={BTN.ghost}><Printer size={15} aria-hidden="true" />{tr("Print report")}</button>
          <button type="button" onClick={load} className={BTN.ghost} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />{tr("Refresh")}</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tr("Date range")}>
        {RANGES.map((option) => (
          <button key={option.key} type="button" aria-pressed={rangeKey === option.key} onClick={() => setRangeKey(option.key)}
            className={`min-h-[40px] rounded-xl border px-3.5 text-[13.5px] font-semibold transition-colors ${rangeKey === option.key ? "border-gold-500 bg-gold-50 text-navy-800 dark:bg-gold-500/15 dark:text-gold-200" : "border-line-strong text-ink-soft hover:bg-frost-50"}`}>
            {tr(option.label)}
          </button>
        ))}
      </div>
      {rangeKey === "custom" && (
        <form onSubmit={applyCustom} className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-ink-soft">{tr("From")}</span><input type="date" value={draft.start} max={draft.end || undefined} onChange={(event) => { const value = event.target.value; setDraft((current) => ({ ...current, start: value })); }} className={`${INPUT} w-[180px]`} /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-ink-soft">{tr("To")}</span><input type="date" value={draft.end} min={draft.start || undefined} onChange={(event) => { const value = event.target.value; setDraft((current) => ({ ...current, end: value })); }} className={`${INPUT} w-[180px]`} /></label>
          <button type="submit" className={BTN.gold}>{tr("Apply")}</button>
          {customError && <p role="alert" className="basis-full text-[13px] text-rose-700 dark:text-[#fecdd3]">{customError}</p>}
        </form>
      )}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[14px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-[#fecdd3]">{error}</p>}
      <div className={`space-y-5 transition-opacity ${refreshing ? "opacity-60" : ""}`} aria-busy={refreshing}>

      <Card title={tr("Returned versus abandoned")} subtitle={tr("How every found item has ended up so far")}>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label={outcomeBars[0].label} value={outcomes.returned} color={outcomeBars[0].color} hint={tr("{0}% of all found items", { "0": outcomes.return_rate })} />
          <Tile label={outcomeBars[1].label} value={outcomes.auctioned} color={outcomeBars[1].color} hint={tr("Sold after 30 days unclaimed")} />
          <Tile label={outcomeBars[2].label} value={outcomes.abandoned} color={outcomeBars[2].color} hint={outcomes.auction_forfeits ? tr("{0} auction win(s) forfeited", { "0": outcomes.auction_forfeits }) : tr("Never claimed or collected")} />
          <Tile label={outcomeBars[3].label} value={outcomes.in_custody} color={outcomeBars[3].color} hint={data.handover.awaiting ? tr("{0} waiting for pickup", { "0": data.handover.awaiting }) : tr("Waiting for an owner")} />
        </dl>
        {outcomes.total_found > 0 ? (
          <div className="mt-4" role="img" aria-label={outcomeBars.map((bar) => `${bar.label}: ${bar.value}`).join(", ")}>
            <div className="flex h-4 overflow-hidden rounded-full" style={{ background: tone.empty, gap: 2 }}>
              {outcomeBars.filter((bar) => bar.value > 0).map((bar) => <div key={bar.key} style={{ width: `${(bar.value / outcomes.total_found) * 100}%`, background: bar.color }} title={`${bar.label}: ${bar.value}`} />)}
            </div>
            <p className="mt-2 text-[12.5px] text-ink-muted">{tr("{0} of {1} found items are closed: returned, auctioned or abandoned.", { "0": closedTotal, "1": outcomes.total_found })}</p>
          </div>
        ) : <p className="mt-4 text-[13.5px] text-ink-muted">{tr("No found items have been recorded yet.")}</p>}
        <AsTable label={tr("View as a table")} headers={[tr("Outcome"), tr("Items")]} rows={outcomeBars.map((bar) => [bar.label, bar.value])} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={tr("Most lost item categories")} subtitle={tr("Share of all lost reports")}>
          {noLost ? <p className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-[14px] text-ink-muted">{tr("No lost reports yet.")}</p> : (
            <>
              <div className="grid items-center gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
                <div className="relative mx-auto h-[220px] w-[220px]" role="img" aria-label={slices.map((slice) => `${slice.name}: ${slice.value}`).join(", ")}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={slices} dataKey="value" nameKey="name" innerRadius={62} outerRadius={104} paddingAngle={2} stroke={tone.surface} strokeWidth={2} startAngle={90} endAngle={-270}>
                        {slices.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ ...tone.tooltip, borderRadius: 12, fontSize: 13 }} itemStyle={{ color: tone.tooltip.color }} formatter={(value, name) => [`${Number(value ?? 0)} (${Math.round((Number(value ?? 0) / Math.max(slicesTotal, 1)) * 100)}%)`, String(name)]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-[family-name:var(--font-heading)] text-[30px] font-semibold leading-none tabular-nums text-ink">{data.lost_total.toLocaleString()}</span>
                    <span className="mt-1 text-[12px] text-ink-muted">{tr("lost reports")}</span>
                  </div>
                </div>
                <ul className="space-y-2">
                  {slices.map((slice) => (
                    <li key={slice.name} className="flex items-center gap-2.5 text-[14px]">
                      <span className="size-3 shrink-0 rounded-[4px]" style={{ background: slice.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-ink-soft">{slice.name}</span>
                      <span className="font-semibold tabular-nums text-ink">{slice.value}</span>
                      <span className="w-10 text-right text-[12.5px] tabular-nums text-ink-muted">{Math.round((slice.value / Math.max(slicesTotal, 1)) * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <AsTable label={tr("View as a table")} headers={[tr("Category"), tr("Reports")]} rows={slices.map((slice) => [slice.name, slice.value])} />
            </>
          )}
        </Card>

        <Card title={tr("Busiest days")} subtitle={busiest.weekday ? tr("{0} is when most items are lost", { "0": busiest.weekday }) : tr("Lost reports by day of the week")}>
          {noLost ? <p className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-[14px] text-ink-muted">{tr("No lost reports yet.")}</p> : (
            <>
              <div role="img" aria-label={data.lost_by_weekday.map((entry) => `${entry.name}: ${entry.count}`).join(", ")}>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={data.lost_by_weekday} margin={{ top: 18, right: 4, left: -22, bottom: 0 }} barCategoryGap="28%">
                    <XAxis dataKey="day" axisLine={{ stroke: tone.grid }} tickLine={false} tick={{ fontSize: 12, fill: tone.tick }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: tone.tick }} allowDecimals={false} />
                    <Tooltip cursor={{ fill: mode === "dark" ? "rgba(209,161,83,0.08)" : "rgba(31,49,96,0.05)" }} contentStyle={{ ...tone.tooltip, borderRadius: 12, fontSize: 13 }} labelStyle={{ color: tone.tooltip.color }} itemStyle={{ color: tone.tooltip.color }} formatter={(value) => [Number(value ?? 0), tr("Lost reports")]} labelFormatter={(label) => data.lost_by_weekday.find((entry) => entry.day === label)?.name ?? label} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={36}>
                      {data.lost_by_weekday.map((entry) => <Cell key={entry.day} fill={entry.name === busiest.weekday ? GOLD : tone.bar} />)}
                      <LabelList dataKey="count" position="top" style={{ fontSize: 12, fill: tone.tick }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <AsTable label={tr("View as a table")} headers={[tr("Day"), tr("Lost reports")]} rows={data.lost_by_weekday.map((entry) => [entry.name, entry.count])} />
            </>
          )}
        </Card>
      </div>

      <Card title={tr("Busiest months")} subtitle={busiest.month ? tr("{0} had the most lost reports. Each square is one weekday in one month.", { "0": busiest.month }) : tr("Lost reports by weekday and month, last 12 months")}>
        {noLost ? <p className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-[14px] text-ink-muted">{tr("No lost reports yet.")}</p> : (
          <>
            <div className="overflow-x-auto pb-1">
              <div className="min-w-[560px]" role="img" aria-label={tr("Heatmap of lost reports by weekday and month")}>
                <div className="grid items-center gap-1" style={{ gridTemplateColumns: `34px repeat(${heat.months.length}, minmax(0, 1fr))` }}>
                  <span />
                  {heat.months.map((month) => <span key={month.key} className="truncate text-center text-[11.5px] text-ink-muted" title={month.label}>{month.label.slice(0, 3)}</span>)}
                  {heat.weekdays.map((weekday, row) => (
                    <div key={weekday} className="contents">
                      <span className="text-[11.5px] text-ink-muted">{weekday}</span>
                      {heat.months.map((month) => {
                        const count = month.counts[row] ?? 0;
                        const label = `${weekday}, ${month.label}: ${count} ${count === 1 ? tr("report") : tr("reports")}`;
                        return (
                          <span
                            key={month.key}
                            tabIndex={0}
                            aria-label={label}
                            title={label}
                            onMouseEnter={() => setHover({ label: `${weekday}, ${month.label}`, count })}
                            onFocus={() => setHover({ label: `${weekday}, ${month.label}`, count })}
                            onMouseLeave={() => setHover(null)}
                            onBlur={() => setHover(null)}
                            className="block h-7 rounded-[5px] outline-none ring-offset-1 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-gold-500"
                            style={{ background: cellColor(count, heat.max) }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-ink-muted">
              <p className="min-h-[20px] font-semibold text-ink-soft" aria-live="polite">{hover ? `${hover.label}: ${hover.count} ${hover.count === 1 ? tr("report") : tr("reports")}` : tr("Hover or tab to a square for its count.")}</p>
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span>{tr("Fewer")}</span>
                {[0, ...RAMP[mode].map((_, i) => i + 1)].map((step) => <span key={step} className="size-3.5 rounded-[4px]" style={{ background: step === 0 ? tone.empty : RAMP[mode][step - 1] }} />)}
                <span>{tr("More")}</span>
              </div>
            </div>
            <AsTable label={tr("View months as a table")} headers={[tr("Month"), tr("Lost reports")]} rows={data.lost_by_month.map((entry) => [entry.month, entry.count])} />
          </>
        )}
      </Card>

      <Card title={tr("Campus hotspots")} subtitle={data.hotspots[0] ? tr("{0} has the most reports", { "0": data.hotspots[0].location }) : tr("Where items are lost and found most often")}>
        {data.hotspots.length === 0 ? <p className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-[14px] text-ink-muted">{tr("No locations recorded in this period.")}</p> : (
          <>
            <ul className="space-y-3" aria-label={tr("Campus hotspots")}>
              {data.hotspots.map((spot) => {
                const widest = Math.max(data.hotspots[0].total, 1);
                return (
                  <li key={spot.location}>
                    <div className="flex items-center justify-between gap-3 text-[14px]">
                      <span className="flex min-w-0 items-center gap-1.5 text-ink-soft"><MapPin size={14} className="shrink-0 text-ink-muted" aria-hidden="true" /><span className="truncate">{spot.location}</span></span>
                      <span className="shrink-0 font-semibold tabular-nums text-ink">{spot.total}</span>
                    </div>
                    <div className="mt-1 flex h-3 overflow-hidden rounded-full" style={{ background: tone.empty, gap: 2, width: "100%" }} title={`${spot.location}: ${spot.lost} ${tr("lost")}, ${spot.found} ${tr("found")}`}>
                      <div style={{ width: `${(spot.lost / widest) * 100}%`, background: SERIES[mode][0] }} />
                      <div style={{ width: `${(spot.found / widest) * 100}%`, background: SERIES[mode][2] }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex items-center gap-4 text-[12.5px] text-ink-muted" aria-hidden="true">
              <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px]" style={{ background: SERIES[mode][0] }} />{tr("Lost")}</span>
              <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px]" style={{ background: SERIES[mode][2] }} />{tr("Found")}</span>
            </div>
            <AsTable label={tr("View as a table")} headers={[tr("Location"), tr("Lost"), tr("Found"), tr("Total")]} rows={data.hotspots.map((spot) => [spot.location, spot.lost, spot.found, spot.total])} />
          </>
        )}
      </Card>
      </div>
    </div>
  );
}
