import { useCallback, useEffect, useState } from "react";
import { ReceiptText, Search } from "lucide-react";
import EmptyState from "../../components/ui/EmptyState";
import { BTN, INPUT } from "../../components/ui/primitives";
import { DataTable, SegmentedFilter, StatusPill, type Tone } from "../../components/ui/management";
import { AdminTableSkeleton } from "../../components/LoadingSkeleton";
import { formatDateTime } from "../../utils/countdown";
import { fetchReceipts, peso, type ReceiptList, type ReceiptRow } from "../../utils/incomeApi";
import { tr } from "../../utils/preferences";
import { METHOD_LABEL, ReceiptModal } from "./PaymentModals";

type KindFilter = "" | ReceiptRow["kind"];
const PAGE = 25;
const KIND_LABEL: Record<ReceiptRow["kind"], string> = { payment: "Payment", claim: "Item handover", auction: "Auction collection" };
const KIND_TONE: Record<ReceiptRow["kind"], Tone> = { payment: "gold", claim: "iris", auction: "mint" };

/** Every receipt the office has issued (payments, item handovers, auction collections): search it, open it, print it, email it again, see its history. */
export default function ReceiptsRegister() {
  const [kind, setKind] = useState<KindFilter>("");
  const [status, setStatus] = useState("");
  const [word, setWord] = useState("");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ReceiptList | null>(null);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<{ kind: ReceiptRow["kind"]; id: string } | null>(null);

  useEffect(() => { const timer = window.setTimeout(() => { setQuery(word.trim()); setOffset(0); }, 300); return () => window.clearTimeout(timer); }, [word]);
  useEffect(() => { setOffset(0); }, [kind, status, start, end]);
  const load = useCallback(() => {
    fetchReceipts({ kind, q: query, status, start, end }, PAGE, offset).then((value) => { setData(value); setError(""); }).catch((failure) => setError(failure instanceof Error ? failure.message : tr("Unable to load the receipts.")));
  }, [kind, query, status, start, end, offset]);
  useEffect(() => { load(); }, [load]);

  const counts = data?.counts;
  const total = data?.total ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedFilter
          label="Receipt type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "", label: "All", count: counts ? counts.payment + counts.claim + counts.auction : undefined },
            { value: "payment", label: "Payments", count: counts?.payment },
            { value: "claim", label: "Item handovers", count: counts?.claim },
            { value: "auction", label: "Auction collections", count: counts?.auction },
          ]}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <label className="relative block"><span className="sr-only">{tr("Search receipts")}</span>
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input value={word} onChange={(event) => setWord(event.target.value)} className={`${INPUT} pl-10`} placeholder={tr("Receipt number, item or person")} />
        </label>
        <label className="block"><span className="sr-only">{tr("Status")}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={INPUT}><option value="">{tr("Any status")}</option><option value="valid">{tr("Valid")}</option><option value="reversed">{tr("Reversed")}</option></select></label>
        <label className="block"><span className="sr-only">{tr("From")}</span><input type="date" value={start} max={end || undefined} onChange={(event) => setStart(event.target.value)} className={INPUT} aria-label={tr("From")} /></label>
        <label className="block"><span className="sr-only">{tr("To")}</span><input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} className={INPUT} aria-label={tr("To")} /></label>
      </div>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>}
      {!data && !error && <AdminTableSkeleton rows={6} />}
      {data && data.receipts.length === 0 && <EmptyState icon={<ReceiptText size={20} />} title={tr("No receipts match")}>{tr("Try a different word, type or dates. Receipts appear here when a payment is confirmed, an item is handed over or an auction is collected.")}</EmptyState>}
      {data && data.receipts.length > 0 && (
        <DataTable
          caption={tr("Receipts register")}
          minWidth={980}
          columns={[{ key: "no", label: "Receipt" }, { key: "item", label: "Item" }, { key: "person", label: "Person" }, { key: "amount", label: "Amount", className: "text-right" }, { key: "when", label: "Issued" }, { key: "status", label: "Status" }, { key: "actions", label: "" }]}
          isEmpty={false}
          empty=""
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
          {data.receipts.map((row) => (
            <tr key={`${row.kind}-${row.id}`}>
              <td>
                <span className="block whitespace-nowrap font-mono text-[13px] font-semibold text-ink">{row.receipt_no}</span>
                <span className="mt-1 inline-block"><StatusPill tone={KIND_TONE[row.kind]}>{tr(KIND_LABEL[row.kind])}</StatusPill></span>
              </td>
              <td className="max-w-[260px] text-[13.5px] text-ink-soft">{row.item}{row.method ? <span className="block text-[12.5px] text-ink-muted">{tr(METHOD_LABEL[row.method] ?? row.method)}{row.has_proof ? ` · ${tr("receipt image kept")}` : ""}</span> : null}</td>
              <td className="text-[13.5px]">{row.person || "—"}{row.issued_by ? <span className="block text-[12.5px] text-ink-muted">{tr("Confirmed by {0}", { "0": row.issued_by })}</span> : null}</td>
              <td className={`text-right font-semibold tabular-nums text-ink ${row.status === "reversed" ? "line-through opacity-60" : ""}`}>{row.amount ? peso(row.amount) : "—"}</td>
              <td className="whitespace-nowrap text-[13.5px] text-ink-muted">{row.released_at ? formatDateTime(row.released_at) : "—"}</td>
              <td><StatusPill tone={row.status === "reversed" ? "rose" : "mint"}>{row.status === "reversed" ? tr("Reversed") : tr("Valid")}</StatusPill></td>
              <td className="mgmt-actions text-right"><button type="button" onClick={() => setViewing({ kind: row.kind, id: row.id })} className={`${BTN.ghost} !min-h-[34px] !px-3 text-[13px]`}><ReceiptText size={14} aria-hidden="true" />{tr("Open")}</button></td>
            </tr>
          ))}
        </DataTable>
      )}
      {viewing && <ReceiptModal kind={viewing.kind} id={viewing.id} onClose={() => setViewing(null)} onChanged={load} />}
    </div>
  );
}
