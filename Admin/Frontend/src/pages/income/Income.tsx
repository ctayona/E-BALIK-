import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Database, Download, Gavel, Hourglass, PackageOpen, PhilippinePeso, Plus, QrCode, ReceiptText, RefreshCw, RotateCcw } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT, PageHeader } from "../../components/ui/primitives";
import { DataTable, SegmentedFilter, StatusPill, type Tone } from "../../components/ui/management";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { formatDateTime } from "../../utils/countdown";
import { canDelete } from "../../utils/permissions";
import { tr } from "../../utils/preferences";
import {
  IncomeSetupError, addIncomeEntry, downloadIncomeCsv, fetchIncomeEntries, fetchIncomeSummary, peso,
  type IncomeEntry, type IncomeKind, type IncomeMethod, type IncomeSource, type IncomeSummary, type ManualEntryInput,
} from "../../utils/incomeApi";

type Range = "month" | "quarter" | "year" | "twelve" | "all";
type SourceFilter = "" | IncomeSource;

const PAGE = 25;
// Gold for the Auction Hall, mint for Smart Tags, periwinkle for anything else: the same three everywhere on this page.
const COLOR: Record<IncomeSource, string> = { auction: "#d1a153", smart_tag: "#2fae8e", other: "#6e8ef0" };
const SOURCE_TONE: Record<IncomeSource, Tone> = { auction: "gold", smart_tag: "mint", other: "iris" };
const SOURCE_LABEL: Record<IncomeSource, string> = { auction: "Auction Hall", smart_tag: "Smart Tags", other: "Other" };
const KIND_LABEL: Record<IncomeKind, string> = { sale: "Sale", refund: "Refund", adjustment: "Adjustment" };
const METHOD_LABEL: Record<IncomeMethod, string> = { cash: "Cash", gcash: "GCash", maya: "Maya", bank: "Bank transfer", other: "Other" };

/** Today on campus (Manila, UTC+8) as YYYY-MM-DD. */
const campusToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

function rangeDates(range: Range): { start: string; end: string } {
  const end = campusToday();
  const [year, month] = end.split("-").map(Number);
  const first = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
  if (range === "month") return { start: first(year, month), end };
  if (range === "quarter") { const back = new Date(Date.UTC(year, month - 3, 1)); return { start: first(back.getUTCFullYear(), back.getUTCMonth() + 1), end }; }
  if (range === "year") return { start: `${year}-01-01`, end };
  if (range === "twelve") { const back = new Date(Date.UTC(year, month - 12, 1)); return { start: first(back.getUTCFullYear(), back.getUTCMonth() + 1), end }; }
  return { start: "2020-01-01", end };
}

const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", year: "2-digit", timeZone: "UTC" });

function StatCard({ label, value, note, icon, tone }: { label: string; value: string; note?: string; icon: React.ReactNode; tone: "gold" | "mint" | "iris" | "rose" | "slate" }) {
  const chip = {
    gold: "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950",
    mint: "bg-[linear-gradient(145deg,#9fe0ca,#2fae8e)] text-white",
    iris: "bg-[linear-gradient(145deg,#c3d0fb,#6e8ef0)] text-white",
    rose: "bg-[linear-gradient(145deg,#fda4af,#e11d48)] text-white",
    slate: "bg-frost-100 text-ink-soft",
  }[tone];
  return (
    <div className="glass-panel flex items-start gap-3.5 p-4">
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${chip}`} aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink-muted">{tr(label)}</p>
        <p className="mt-0.5 font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight tabular-nums text-ink">{value}</p>
        {note && <p className="mt-0.5 text-[12.5px] leading-5 text-ink-muted">{note}</p>}
      </div>
    </div>
  );
}

function SetupNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="glass-panel mx-auto max-w-[680px] p-6 sm:p-8" role="alert">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950"><Database size={22} aria-hidden="true" /></span>
      <h2 className="mt-4 font-[family-name:var(--font-heading)] text-[22px] font-semibold text-ink">{tr("Income tracking needs one database step")}</h2>
      <ol className="mt-4 space-y-2 text-[14px] leading-6 text-ink-soft">
        <li>{tr("Open the Supabase dashboard and choose SQL Editor.")}</li>
        <li>{tr("Paste and run the contents of Server/manual_migrations/20261022_income_ledger.sql.")}</li>
        <li>{tr("Come back here and press Check again. Auctions already collected are added to the ledger automatically.")}</li>
      </ol>
      <p className="mt-4 rounded-xl bg-frost-50 px-4 py-3 text-[13px] text-ink-muted">{message}</p>
      <button type="button" onClick={onRetry} className={`${BTN.primary} mt-5`}><RefreshCw size={16} aria-hidden="true" />{tr("Check again")}</button>
    </section>
  );
}

const EMPTY_ENTRY: ManualEntryInput = { kind: "adjustment", source: "auction", amount: "", description: "", method: "cash", receipt_no: "", notes: "", received_on: "", source_ref: "" };

/** Super admins: add money the system did not record by itself, or correct it. Nothing is ever edited or deleted afterwards. */
function EntryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ManualEntryInput>({ ...EMPTY_ENTRY, received_on: campusToday() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof ManualEntryInput>(key: K, value: ManualEntryInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const amountText = form.amount.trim();
  const amountOk = /^-?\d{1,7}(\.\d{1,2})?$/.test(amountText) && Number(amountText) !== 0 && (form.kind === "adjustment" || !amountText.startsWith("-"));
  const needsReason = form.kind !== "sale";
  const valid = amountOk && form.description.trim().length >= 4 && (!needsReason || form.notes.trim().length >= 8) && Boolean(form.received_on) && form.received_on <= campusToday();
  const sourceOptions: IncomeSource[] = form.kind === "sale" ? ["other"] : ["auction", "smart_tag", "other"];

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await addIncomeEntry(form);
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to record the entry."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminModal
      title={tr("Record an income entry")}
      description={tr("Auction and Smart Tag sales are recorded automatically. Use this for other payments, refunds and corrections. Entries cannot be edited later.")}
      icon={<ReceiptText size={19} />}
      tone="gold"
      size="md"
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
          <button type="button" onClick={() => void save()} disabled={!valid || busy} className={BTN.primary}>{busy ? tr("Saving…") : tr("Record entry")}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <SegmentedFilter
          label="Entry type"
          value={form.kind}
          onChange={(kind) => setForm((current) => ({ ...current, kind, source: kind === "sale" ? "other" : current.source }))}
          options={[{ value: "adjustment", label: "Adjustment" }, { value: "refund", label: "Refund" }, { value: "sale", label: "Other income" }]}
        />
        <p className="rounded-xl bg-frost-50 px-3.5 py-2.5 text-[13px] leading-5 text-ink-muted">
          {form.kind === "refund" ? tr("Money given back. Type the amount without a minus sign: it is subtracted from the totals.")
            : form.kind === "adjustment" ? tr("A correction. Type a negative amount (for example -50) to lower the totals, or a positive one to raise them.")
            : tr("Money received for something other than an auction or a Smart Tag, for example a replacement sticker.")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("For")}</span>
            <select value={form.source} onChange={(event) => set("source", event.target.value as IncomeSource)} className={INPUT}>
              {sourceOptions.map((source) => <option key={source} value={source}>{tr(SOURCE_LABEL[source])}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Amount")}</span>
            <span className="relative block">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-ink-muted" aria-hidden="true">₱</span>
              <input value={form.amount} onChange={(event) => set("amount", event.target.value.replace(/[^0-9.-]/g, ""))} inputMode="decimal" className={`${INPUT} pl-8`} data-autofocus aria-invalid={Boolean(amountText) && !amountOk} />
            </span>
            {Boolean(amountText) && !amountOk && <span className="mt-1 block text-[12.5px] text-rose-600">{form.kind === "adjustment" ? tr("Enter an amount such as 150 or -50 (not zero).") : tr("Enter an amount such as 150 or 150.50.")}</span>}
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Description")}</span>
          <input value={form.description} onChange={(event) => set("description", event.target.value)} maxLength={255} placeholder={tr("Refund for auction of a black laptop")} className={INPUT} />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Paid by")}</span>
            <select value={form.method} onChange={(event) => set("method", event.target.value as IncomeMethod)} className={INPUT}>
              {(Object.keys(METHOD_LABEL) as IncomeMethod[]).map((method) => <option key={method} value={method}>{tr(METHOD_LABEL[method])}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Date")}</span>
            <input type="date" value={form.received_on} max={campusToday()} onChange={(event) => set("received_on", event.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Receipt no. (optional)")}</span>
            <input value={form.receipt_no} onChange={(event) => set("receipt_no", event.target.value)} maxLength={40} className={INPUT} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{needsReason ? tr("Reason") : tr("Notes (optional)")}</span>
          <textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} maxLength={500} rows={3} className={`${INPUT} py-2.5`} placeholder={needsReason ? tr("Why this refund or correction is needed. It stays in the record.") : ""} />
          {needsReason && form.notes.trim().length > 0 && form.notes.trim().length < 8 && <span className="mt-1 block text-[12.5px] text-rose-600">{tr("Write at least 8 characters.")}</span>}
        </label>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{error}</p>}
      </div>
    </AdminModal>
  );
}

/**
 * Income: what the Auction Hall and Smart Tags brought in, what is still owed, and the ledger behind every figure.
 * Sales are written by the workflows themselves (an auction paid and collected, a priced tag approved at the office).
 */
export default function Income({ onNavigate }: { onNavigate?: (page: "auctions" | "smart-tags") => void }) {
  const superAdmin = canDelete();
  const [range, setRange] = useState<Range>("twelve");
  const [source, setSource] = useState<SourceFilter>("");
  const [summary, setSummary] = useState<IncomeSummary | null>(null);
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dates = useMemo(() => rangeDates(range), [range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, page] = await Promise.all([
        fetchIncomeSummary(dates.start, dates.end),
        fetchIncomeEntries(dates.start, dates.end, source, PAGE, offset),
      ]);
      setSummary(nextSummary);
      setEntries(page.entries);
      setTotal(page.total);
      setSetup("");
    } catch (failure) {
      if (failure instanceof IncomeSetupError) setSetup(failure.message);
      else setError(failure instanceof Error ? failure.message : tr("Unable to load income."));
    } finally {
      setLoading(false);
    }
  }, [dates, source, offset]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setOffset(0); }, [range, source]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadIncomeCsv(dates.start, dates.end, source);
    } catch (failure) {
      showInfoModal({ variant: "error", title: tr("Export failed"), message: failure instanceof Error ? failure.message : tr("Unable to export.") });
    } finally {
      setExporting(false);
    }
  };

  if (setup) return <div className="space-y-6"><PageHeader title={tr("Income")} /><SetupNotice message={setup} onRetry={() => void load()} /></div>;

  const change = summary && summary.previous_month > 0 ? ((summary.this_month - summary.previous_month) / summary.previous_month) * 100 : null;
  const split = summary ? (["auction", "smart_tag", "other"] as IncomeSource[]).map((key) => ({ key, value: Math.max(0, summary.by_source[key]) })) : [];
  const splitTotal = split.reduce((sum, part) => sum + part.value, 0);
  const chart = (summary?.by_month ?? []).map((row) => ({ ...row, label: monthLabel(row.month) }));
  const owed = summary ? summary.pending.auction + summary.pending.smart_tag : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr("Income")}
        description={tr("Money from the Auction Hall and Smart Tags. Sales are recorded by themselves when an auction is collected or a priced tag is approved.")}
        actions={(
          <>
            <button type="button" onClick={() => void exportCsv()} disabled={exporting || loading} className={BTN.ghost}><Download size={16} aria-hidden="true" />{exporting ? tr("Exporting…") : tr("Export CSV")}</button>
            {superAdmin && <button type="button" onClick={() => setAdding(true)} className={BTN.gold}><Plus size={16} aria-hidden="true" />{tr("Record entry")}</button>}
          </>
        )}
      />

      <SegmentedFilter
        label="Period"
        value={range}
        onChange={setRange}
        options={[{ value: "month", label: "This month" }, { value: "quarter", label: "3 months" }, { value: "twelve", label: "12 months" }, { value: "year", label: "This year" }, { value: "all", label: "All time" }]}
      />

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>}

      {/* The headline: the period's income, this month against last, and how it splits between the two sources. */}
      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,#22366a_0%,#162448_60%,#0e1830_100%)] p-5 text-white shadow-[0_24px_60px_-34px_rgba(14,24,48,0.9)] sm:p-7" aria-label={tr("Income for the period")}>
        <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-[radial-gradient(circle,rgba(209,161,83,0.35),transparent_68%)]" />
        {loading && !summary ? <SkeletonBlock className="h-[132px] w-full rounded-2xl opacity-30" /> : summary && (
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end">
            <div>
              <p className="text-[13px] font-semibold text-gold-300">{tr("Received {0} to {1}", { "0": summary.range.start, "1": summary.range.end })}</p>
              <p className="mt-1 font-[family-name:var(--font-heading)] text-[40px] font-semibold leading-none tabular-nums sm:text-[48px]">{peso(summary.total)}</p>
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-navy-100">
                <span>{tr("This month: {0}", { "0": peso(summary.this_month) })}</span>
                {change !== null && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] font-semibold ${change >= 0 ? "bg-[rgba(47,174,142,0.24)] text-[#b5f0dc]" : "bg-[rgba(244,63,94,0.26)] text-[#ffd1d9]"}`}>
                    {change >= 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
                    {tr("{0}% vs last month", { "0": Math.abs(change).toFixed(0) })}
                  </span>
                )}
                <span className="text-navy-200">{tr("{0} sales", { "0": summary.sales })}</span>
              </p>
            </div>
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-white/10" role="img" aria-label={tr("How the income splits between sources")}>
                {splitTotal > 0 && split.map((part) => part.value > 0 && <span key={part.key} style={{ width: `${(part.value / splitTotal) * 100}%`, background: COLOR[part.key] }} />)}
              </div>
              <ul className="mt-3 grid grid-cols-3 gap-2">
                {split.map((part) => (
                  <li key={part.key} className="rounded-2xl bg-white/[0.06] px-3 py-2.5 ring-1 ring-white/10">
                    <span className="flex items-center gap-1.5 text-[12.5px] text-navy-100"><span className="size-2 rounded-full" style={{ background: COLOR[part.key] }} aria-hidden="true" />{tr(SOURCE_LABEL[part.key])}</span>
                    <span className="mt-0.5 block font-semibold tabular-nums">{peso(summary.by_source[part.key])}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Waiting to be paid" value={peso(owed)} tone="gold" icon={<Hourglass size={19} />}
            note={tr("{0} auction pickups, {1} tags waiting for approval", { "0": summary.pending.auction_count, "1": summary.pending.smart_tag_count })} />
          <StatCard label="Unsold Smart Tags" value={peso(summary.pending.stock_value)} tone="mint" icon={<PackageOpen size={19} />}
            note={tr("{0} blank tags at their current price", { "0": summary.pending.stock_count })} />
          <StatCard label="Refunds and corrections" value={peso(summary.refunds)} tone="rose" icon={<RotateCcw size={19} />} note={tr("Already subtracted from the totals")} />
          <StatCard label="Ledger entries" value={String(summary.entries)} tone="iris" icon={<ReceiptText size={19} />} note={tr("Every peso, with who recorded it")} />
        </div>
      )}

      {summary && (
        <section className="glass-panel p-5 sm:p-6" aria-label={tr("Income by month")}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">{tr("Income by month")}</h2>
              <p className="text-[12.5px] text-ink-muted">{tr("Stacked by source. Refunds lower the month they were given.")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {onNavigate && <button type="button" onClick={() => onNavigate("auctions")} className={`${BTN.ghost} !min-h-[38px]`}><Gavel size={15} aria-hidden="true" />{tr("Auctions")}</button>}
              {onNavigate && <button type="button" onClick={() => onNavigate("smart-tags")} className={`${BTN.ghost} !min-h-[38px]`}><QrCode size={15} aria-hidden="true" />{tr("Smart Tag prices")}</button>}
            </div>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }} />
                <YAxis tickLine={false} axisLine={false} width={64} tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }} tickFormatter={(value: number) => `₱${value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : value}`} />
                <Tooltip cursor={{ fill: "rgba(110,142,240,0.08)" }} formatter={(value, name) => [peso(Number(value)), tr(SOURCE_LABEL[name as IncomeSource] ?? String(name))]} contentStyle={{ borderRadius: 14, border: "1px solid var(--color-line)", background: "var(--surface)" }} />
                {(["auction", "smart_tag", "other"] as IncomeSource[]).map((key, index) => (
                  <Bar key={key} dataKey={key} stackId="income" fill={COLOR[key]} radius={index === 2 ? [6, 6, 0, 0] : [0, 0, 0, 0]} maxBarSize={44} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">{tr("Ledger")}</h2>
          <SegmentedFilter
            label="Source"
            value={source}
            onChange={setSource}
            options={[{ value: "", label: "All" }, { value: "auction", label: "Auction Hall" }, { value: "smart_tag", label: "Smart Tags" }, { value: "other", label: "Other" }]}
          />
        </div>
        {loading && !entries.length ? <AdminTableSkeleton rows={6} /> : (
          <DataTable
            caption={tr("Income ledger")}
            minWidth={900}
            columns={[{ key: "when", label: "Received" }, { key: "what", label: "Description" }, { key: "source", label: "Source" }, { key: "method", label: "Method" }, { key: "by", label: "Paid by" }, { key: "amount", label: "Amount", className: "text-right" }]}
            isEmpty={!entries.length}
            empty={tr("No income in this period yet. Sales appear here when an auction is collected or a priced Smart Tag is approved.")}
            footer={total > PAGE && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-ink-muted">
                <span>{tr("{0}–{1} of {2}", { "0": offset + 1, "1": Math.min(offset + PAGE, total), "2": total })}</span>
                <span className="flex gap-2">
                  <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className={`${BTN.ghost} !min-h-[36px]`}>{tr("Previous")}</button>
                  <button type="button" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className={`${BTN.ghost} !min-h-[36px]`}>{tr("Next")}</button>
                </span>
              </div>
            )}
          >
            {entries.map((entry) => (
              <tr key={entry.entry_id}>
                <td className="whitespace-nowrap text-[13.5px]">{formatDateTime(entry.received_at)}</td>
                <td>
                  <span className="block font-semibold text-ink">{entry.description}</span>
                  <span className="block text-[12.5px] text-ink-muted">
                    {entry.kind !== "sale" && <>{tr(KIND_LABEL[entry.kind])}{entry.notes ? `: ${entry.notes}` : ""} · </>}
                    {entry.receipt_no ? tr("Receipt {0}", { "0": entry.receipt_no }) + " · " : ""}{tr("Recorded by {0}", { "0": entry.recorded_by_name || tr("System") })}
                  </span>
                </td>
                <td><StatusPill tone={SOURCE_TONE[entry.source] ?? "slate"}>{tr(SOURCE_LABEL[entry.source] ?? entry.source)}</StatusPill></td>
                <td className="text-[13.5px]">{tr(METHOD_LABEL[entry.method] ?? entry.method)}</td>
                <td className="text-[13.5px]">{entry.payer_name || "—"}</td>
                <td className={`mgmt-actions text-right font-semibold tabular-nums ${entry.amount < 0 ? "text-rose-700 dark:text-rose-300" : "text-ink"}`}>
                  <span className="inline-flex items-center gap-1"><PhilippinePeso size={13} className="opacity-50" aria-hidden="true" />{peso(entry.amount).replace("₱", "")}</span>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      {adding && <EntryModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />}
    </div>
  );
}
