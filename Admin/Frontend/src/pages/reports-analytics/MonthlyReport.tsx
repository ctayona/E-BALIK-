import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, BellRing, CalendarX2, ChevronLeft, ChevronRight, Download, Minus, Printer, RefreshCw, Tag } from "lucide-react";
import { AdminMetricSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import EmptyState from "../../components/ui/EmptyState";
import { BTN, INPUT } from "../../components/ui/primitives";
import { formatDateTime } from "../../utils/countdown";
import { downloadMonthlyReport, fetchMonthlyReport, type MonthlyReport, type RankedCount } from "../../utils/opsApi";
import { peso } from "../../utils/incomeApi";
import { tr } from "../../utils/preferences";

const manilaMonth = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
const shiftMonth = (month: string, by: number) => {
  const [year, number] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year, number - 1 + by, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
};
const STATUS_LABEL: Record<string, string> = { pending: "Waiting for review", approved: "Approved", rejected: "Rejected", collected: "Collected", cancelled: "Cancelled", ready: "Ready for pickup" };

/** How this month compares with the one before. Neutral colours on purpose: more lost reports is not "bad news" and more returns is not automatically "good". */
function Change({ value, previousLabel }: { value: number | null | undefined; previousLabel: string }) {
  if (value == null) return <span className="text-[12.5px] text-ink-muted">{tr("No figure for {0} to compare with", { "0": previousLabel })}</span>;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const words = value === 0 ? tr("Same as {0}", { "0": previousLabel }) : tr("{0}% {1} than {2}", { "0": Math.abs(value), "1": value > 0 ? tr("more") : tr("less"), "2": previousLabel });
  return <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-iris-700 dark:text-iris-300"><Icon size={14} aria-hidden="true" />{words}</span>;
}

function Panel({ title, note, children, className = "" }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`glass-panel min-w-0 p-5 ${className}`} style={{ breakInside: "avoid" }}>
      <h2 className="font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">{title}</h2>
      {note && <p className="mt-0.5 text-[12.5px] text-ink-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Unavailable({ what }: { what: string }) {
  return <EmptyState title={tr("{0} is not available yet", { "0": what })}>{tr("The data behind this section is not set up in the database. The rest of the report is unaffected.")}</EmptyState>;
}

function Ranked({ title, rows }: { title: string; rows: RankedCount[] }) {
  const top = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-[13.5px] font-semibold text-ink-soft">{title}</h3>
      {rows.length === 0 ? <p className="text-[13px] text-ink-muted">{tr("Nothing recorded this month.")}</p> : (
        <ol className="space-y-2">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3 text-[13.5px]"><span className="truncate text-ink">{row.name}</span><span className="font-semibold tabular-nums text-ink">{row.count}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-frost-100 dark:bg-white/10"><div className="h-full rounded-full bg-[linear-gradient(90deg,#2b4282,#6a84b8)]" style={{ width: `${(row.count / top) * 100}%` }} /></div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function MonthlyReportView() {
  const current = manilaMonth();
  const [month, setMonth] = useState(current);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    try { setReport(await fetchMonthlyReport(target)); setError(""); } catch (failure) { setReport(null); setError(failure instanceof Error ? failure.message : tr("Unable to build the monthly report.")); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(month); }, [load, month]);

  const exportCsv = async () => {
    setExporting(true);
    try { await downloadMonthlyReport(month); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to export the monthly report.")); } finally { setExporting(false); }
  };

  const kpis = useMemo(() => {
    if (!report) return [];
    const { figures, changes } = report;
    return [
      { key: "found_received", label: tr("Found items received"), value: figures.found_received?.toLocaleString() ?? "-" },
      { key: "lost_filed", label: tr("Lost reports filed"), value: figures.lost_filed?.toLocaleString() ?? "-" },
      { key: "returned", label: tr("Returned to owners"), value: figures.returned?.toLocaleString() ?? "-" },
      { key: "claims_filed", label: tr("Claims filed"), value: figures.claims_filed?.toLocaleString() ?? "-" },
      { key: "income", label: tr("Income"), value: figures.income ? peso(figures.income.total) : "-" },
    ].map((item) => ({ ...item, change: changes[item.key] }));
  }, [report]);

  const income = report?.figures.income;
  const incomeParts = income ? [
    { label: tr("Auction Hall"), value: income.auction, color: "#1f3160" },
    { label: tr("Smart Tags"), value: income.smart_tag, color: "#d1a153" },
    { label: tr("Other"), value: income.other, color: "#0f8077" },
  ] : [];
  const incomeBase = Math.max(1, incomeParts.reduce((sum, part) => sum + Math.max(0, part.value), 0));
  const waitingTop = Math.max(1, ...(report?.waiting?.buckets.map((bucket) => bucket.count) ?? [1]));

  return (
    <div className="print-report space-y-5 p-4 sm:p-6">
      <div className="print-hide flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">{tr("Monthly office report")}</h1>
          <p className="mt-1 max-w-[68ch] text-[14px] leading-6 text-ink-muted">{tr("What came in, what went back to owners, what it earned and what is still waiting. Ready to print or send to the office head.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className={`${BTN.ghost} !px-3`} aria-label={tr("Previous month")}><ChevronLeft size={17} aria-hidden="true" /></button>
            <label className="sr-only" htmlFor="report-month">{tr("Month")}</label>
            <input id="report-month" type="month" value={month} min="2020-01" max={current} onChange={(event) => event.target.value && setMonth(event.target.value)} className={`${INPUT} !w-[10.5rem]`} />
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= current} className={`${BTN.ghost} !px-3`} aria-label={tr("Next month")}><ChevronRight size={17} aria-hidden="true" /></button>
          </div>
          <button type="button" onClick={() => void load(month)} disabled={loading} className={BTN.ghost}><RefreshCw size={16} className={loading ? "animate-spin" : ""} aria-hidden="true" />{tr("Refresh")}</button>
          <button type="button" onClick={() => void exportCsv()} disabled={!report || exporting} className={BTN.ghost}><Download size={16} aria-hidden="true" />{exporting ? tr("Preparing…") : tr("Download CSV")}</button>
          <button type="button" onClick={() => window.print()} disabled={!report} className={BTN.primary}><Printer size={16} aria-hidden="true" />{tr("Print or PDF")}</button>
        </div>
      </div>

      {error && <p role="alert" className="print-hide rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-[#fecdd3]">{error}</p>}

      {loading && !report && <div className="space-y-5" aria-busy="true"><AdminMetricSkeleton count={4} /><SkeletonBlock className="h-64 w-full rounded-2xl" /></div>}

      {!loading && !report && !error && <EmptyState icon={<CalendarX2 size={20} />} title={tr("No report for this month")}>{tr("Choose another month.")}</EmptyState>}

      {report && (
        <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <header className="border-b-2 border-gold-400 pb-3">
            <p className="text-[13px] font-medium text-ink-muted">{tr("University of Makati - Lost and Found Office")}</p>
            <h2 className="font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-tight text-ink">{tr("Report for {0}", { "0": report.label })}</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">{tr("{0} to {1}. Prepared {2}.", { "0": report.start, "1": report.end, "2": formatDateTime(report.generated_at) })}</p>
          </header>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {kpis.map((item) => (
              <div key={item.key} className="glass-panel p-4" style={{ breakInside: "avoid" }}>
                <p className="text-[12.5px] font-medium text-ink-muted">{item.label}</p>
                <p className="mt-1 font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-none tabular-nums text-ink">{item.value}</p>
                <div className="mt-2"><Change value={item.change} previousLabel={report.previous_label} /></div>
              </div>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title={tr("Still waiting at the office")} note={tr("Unclaimed found items right now, by how long they have been here")}>
              {report.waiting ? (
                <>
                  <p className="mb-3 font-[family-name:var(--font-heading)] text-[26px] font-semibold tabular-nums text-ink">{report.waiting.total.toLocaleString()} <span className="text-[14px] font-normal text-ink-muted">{tr("items")}</span></p>
                  <ul className="space-y-2.5">
                    {report.waiting.buckets.map((bucket, index) => (
                      <li key={bucket.label} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-3 text-[13.5px]">
                        <span className="text-ink-soft">{bucket.label}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-frost-100 dark:bg-white/10"><span className="block h-full rounded-full" style={{ width: `${(bucket.count / waitingTop) * 100}%`, background: index >= 2 ? "linear-gradient(90deg,#d1a153,#b9873a)" : "linear-gradient(90deg,#2b4282,#6a84b8)" }} /></span>
                        <span className="text-right font-semibold tabular-nums text-ink">{bucket.count}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[12.5px] text-ink-muted">{tr("Items waiting more than 60 days are the ones to send to the Auction Hall or review for disposal.")}</p>
                </>
              ) : <Unavailable what={tr("Waiting items")} />}
            </Panel>

            <Panel title={tr("Claims")} note={tr("Claims filed this month and how quickly items went back")}>
              {report.claims ? (
                <>
                  <dl className="grid grid-cols-3 gap-3">
                    <div><dt className="text-[12.5px] text-ink-muted">{tr("Filed")}</dt><dd className="font-[family-name:var(--font-heading)] text-[24px] font-semibold tabular-nums text-ink">{report.claims.filed}</dd></div>
                    <div><dt className="text-[12.5px] text-ink-muted">{tr("Returned")}</dt><dd className="font-[family-name:var(--font-heading)] text-[24px] font-semibold tabular-nums text-ink">{report.claims.returned}</dd></div>
                    <div><dt className="text-[12.5px] text-ink-muted">{tr("Average days to return")}</dt><dd className="font-[family-name:var(--font-heading)] text-[24px] font-semibold tabular-nums text-ink">{report.claims.average_days_to_return ?? "-"}</dd></div>
                  </dl>
                  {Object.keys(report.claims.by_status).length > 0 ? (
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {Object.entries(report.claims.by_status).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                        <li key={status} className="rounded-full border border-line-strong bg-frost-50 px-3 py-1 text-[13px] text-ink-soft dark:bg-white/[0.05]"><span className="font-semibold tabular-nums text-ink">{count}</span> {tr(STATUS_LABEL[status] ?? status)}</li>
                      ))}
                    </ul>
                  ) : <p className="mt-4 text-[13px] text-ink-muted">{tr("No claims were filed this month.")}</p>}
                </>
              ) : <Unavailable what={tr("Claims")} />}
            </Panel>
          </div>

          <Panel title={tr("What came in")} note={tr("The most common categories and places this month")}>
            {report.intake ? (
              <div className="grid gap-6 md:grid-cols-2">
                <Ranked title={tr("Found items by category")} rows={report.intake.found_by_category} />
                <Ranked title={tr("Found items by place")} rows={report.intake.found_by_location} />
                <Ranked title={tr("Lost reports by category")} rows={report.intake.lost_by_category} />
                <Ranked title={tr("Lost reports by place")} rows={report.intake.lost_by_location} />
              </div>
            ) : <Unavailable what={tr("Intake")} />}
          </Panel>

          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <Panel title={tr("Income")} note={tr("Auction Hall and Smart Tag payments received this month")}>
              {income ? (
                <>
                  <p className="font-[family-name:var(--font-heading)] text-[32px] font-semibold tabular-nums text-ink">{peso(income.total)}</p>
                  <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-frost-100 dark:bg-white/10" role="img" aria-label={incomeParts.map((part) => `${part.label} ${peso(part.value)}`).join(", ")}>
                    {incomeParts.map((part) => part.value > 0 && <span key={part.label} style={{ width: `${(part.value / incomeBase) * 100}%`, background: part.color }} />)}
                  </div>
                  <ul className="mt-3 space-y-2">
                    {incomeParts.map((part) => (
                      <li key={part.label} className="flex items-center gap-2 text-[13.5px]"><span className="size-2.5 shrink-0 rounded-full" style={{ background: part.color }} aria-hidden="true" /><span className="text-ink-soft">{part.label}</span><span className="ml-auto font-semibold tabular-nums text-ink">{peso(part.value)}</span></li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[12.5px] text-ink-muted">{tr("{0} auctions sold, {1} Smart Tags sold, refunds {2}.", { "0": income.auctions_sold, "1": income.tags_sold, "2": peso(income.refunds) })}</p>
                </>
              ) : <Unavailable what={tr("Income")} />}
            </Panel>

            <Panel title={tr("Matching and Smart Tags")}>
              <ul className="space-y-4">
                <li className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-iris-50 text-iris-700 dark:bg-white/[0.06] dark:text-iris-300" aria-hidden="true"><BellRing size={18} /></span>
                  <div><p className="font-[family-name:var(--font-heading)] text-[22px] font-semibold tabular-nums leading-none text-ink">{report.match_alerts ? report.match_alerts.sent : "-"}</p><p className="mt-1 text-[12.5px] text-ink-muted">{tr("match alerts sent to owners")}</p></div>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-800 dark:bg-white/[0.06] dark:text-gold-300" aria-hidden="true"><Tag size={18} /></span>
                  <div><p className="font-[family-name:var(--font-heading)] text-[22px] font-semibold tabular-nums leading-none text-ink">{report.smart_tags ? report.smart_tags.registered : "-"}</p><p className="mt-1 text-[12.5px] text-ink-muted">{tr("Smart Tags registered by owners")}</p></div>
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
