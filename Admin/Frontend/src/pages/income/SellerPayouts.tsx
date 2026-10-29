import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Copy, HandCoins, Hourglass, ImagePlus, Percent, ReceiptText, Send, Settings2, Wallet } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT } from "../../components/ui/primitives";
import { DataTable, RowActions, SegmentedFilter, StatusPill, type Tone } from "../../components/ui/management";
import { AdminTableSkeleton } from "../../components/LoadingSkeleton";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { formatDateTime } from "../../utils/countdown";
import { canDelete } from "../../utils/permissions";
import { peso } from "../../utils/incomeApi";
import { tr } from "../../utils/preferences";
import {
  SellerSetupError, fetchPayoutProofUrl, fetchPayouts, payPayout, saveSellerTerms,
  type PayoutList, type PayoutMethod, type PayoutRow, type PayoutState, type SellerTerms,
} from "../../utils/sellerApi";
import { ReceiptModal } from "./PaymentModals";

const STATE: Record<PayoutState, { label: string; tone: Tone }> = {
  ready: { label: "Ready to pay", tone: "gold" },
  on_hold: { label: "In hold period", tone: "iris" },
  waiting_pickup: { label: "Waiting for pickup", tone: "slate" },
  paid: { label: "Paid", tone: "mint" },
  cancelled: { label: "Cancelled", tone: "rose" },
};
const METHOD: Record<PayoutMethod, string> = { cash: "Cash", gcash: "GCash", maya: "Maya", bank: "Bank transfer" };

/** Send a seller their money. The destination they gave is shown big, because sending to the wrong number is the mistake to avoid. */
function PayModal({ row, onClose, onPaid }: { row: PayoutRow; onClose: () => void; onPaid: () => void }) {
  const [method, setMethod] = useState<PayoutMethod>(row.destination.method);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const electronic = method !== "cash";
  const valid = sure && (!electronic || (reference.trim().length >= 4 && proof));

  const copy = async () => {
    try { await navigator.clipboard.writeText(row.destination.account_number); showInfoModal({ variant: "success", title: tr("Copied"), message: tr("The account number is on your clipboard.") }); } catch { /* clipboard blocked: the number is still on screen */ }
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await payPayout(row.id, { method, reference: reference.trim(), notes: notes.trim(), proof });
      onPaid();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("The payout could not be recorded."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminModal title={tr("Pay the seller")} description={tr("Send the money first, then record it here. The seller gets a payout receipt by email and in the app.")} icon={<HandCoins size={19} />} tone="gold" size="md" busy={busy} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
        <button type="button" onClick={() => void submit()} disabled={!valid || busy} className={BTN.primary}><Send size={16} aria-hidden="true" />{busy ? tr("Recording…") : tr("Record payout and issue receipt")}</button>
      </>}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-[linear-gradient(135deg,#22366a_0%,#0e1830_100%)] p-4 text-white">
          <p className="text-[13px] text-navy-100">{row.title} · {row.seller.name || tr("Seller")}{row.seller.campus_id ? ` (${row.seller.campus_id})` : ""}</p>
          <p className="mt-1 font-[family-name:var(--font-heading)] text-[34px] font-semibold leading-none tabular-nums">{peso(row.payout_amount)}</p>
          <p className="mt-2 text-[12.5px] text-navy-100">{tr("Sold for {0}, office fee {1} ({2}%) already kept.", { "0": peso(row.gross), "1": peso(row.commission), "2": row.commission_rate })}</p>
          <div className="mt-3 rounded-xl bg-white/[0.08] px-3 py-2.5 ring-1 ring-white/10">
            <p className="text-[12.5px] font-semibold text-gold-300">{tr("The seller asked to be paid by {0}", { "0": tr(row.destination.label) })}</p>
            {row.destination.account_number ? (
              <div className="mt-1 flex items-center justify-between gap-3">
                <span><span className="block text-[14px]">{row.destination.account_name}</span><span className="block font-mono text-[18px] tracking-wide">{row.destination.account_number}</span></span>
                <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12.5px] font-semibold hover:bg-white/20"><Copy size={13} aria-hidden="true" />{tr("Copy")}</button>
              </div>
            ) : <p className="mt-1 text-[13.5px]">{tr("In cash at the Lost and Found Office. Ask for their ID.")}</p>}
          </div>
        </div>
        <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("How did you pay?")}</span>
          <select value={method} onChange={(event) => setMethod(event.target.value as PayoutMethod)} className={INPUT}>
            {(Object.keys(METHOD) as PayoutMethod[]).map((key) => <option key={key} value={key}>{tr(METHOD[key])}</option>)}
          </select>
        </label>
        {electronic && (
          <>
            <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Transfer reference number")}</span>
              <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={64} className={INPUT} placeholder={tr("From the GCash, Maya or bank confirmation")} />
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-line-strong px-4 py-3 text-[13.5px] text-ink-soft hover:border-gold-400">
              <ImagePlus size={18} className="text-gold-600" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{proof ? proof.name : tr("Attach the transfer receipt (screenshot)")}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setProof(event.target.files?.[0] ?? null)} />
            </label>
          </>
        )}
        <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Notes (optional)")}</span>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} className={INPUT} />
        </label>
        <label className="flex cursor-pointer gap-3 rounded-xl border border-line p-3 text-[13.5px] text-ink-soft">
          <input type="checkbox" checked={sure} onChange={(event) => setSure(event.target.checked)} className="mt-0.5 size-4 accent-[#1f3160]" />
          <span>{tr("I sent {0} to {1} and checked the account details.", { "0": peso(row.payout_amount), "1": row.seller.name || tr("the seller") })}</span>
        </label>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{error}</p>}
      </div>
    </AdminModal>
  );
}

/** Super administrators: the fee and the rules for new listings. Listings already sent keep the terms their seller accepted. */
function TermsCard({ terms, onSaved }: { terms: SellerTerms; onSaved: () => void }) {
  const [form, setForm] = useState({ enabled: terms.enabled, rate: String(terms.rate), minimum: String(terms.minimum), cap: String(terms.cap), hold_days: String(terms.hold_days), max_active: String(terms.max_active) });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await saveSellerTerms({ enabled: form.enabled, rate: Number(form.rate), minimum: Number(form.minimum), cap: Number(form.cap), hold_days: Number(form.hold_days), max_active: Number(form.max_active) });
      onSaved();
    } catch { /* the error was already shown */ } finally { setBusy(false); }
  };
  const field = (key: "rate" | "minimum" | "cap" | "hold_days" | "max_active", label: string) => (
    <label className="block"><span className="mb-1 block text-[13px] font-semibold text-ink-soft">{tr(label)}</span>
      <input inputMode="decimal" value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value.replace(/[^\d.]/g, "") }))} className={`${INPUT} tabular-nums`} />
    </label>
  );
  return (
    <section className="glass-panel p-5" aria-label={tr("Seller fee terms")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink"><Settings2 size={16} className="text-gold-600" aria-hidden="true" />{tr("Fee and rules for new listings")}</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">{tr("Changes apply to listings sent after you save. Earlier listings keep the fee their seller accepted.")}</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13.5px] font-semibold text-ink-soft">
          <input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} className="size-4 accent-[#1f3160]" />{tr("Accept new listings")}
        </label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {field("rate", "Fee (%)")}{field("minimum", "Minimum fee (₱)")}{field("cap", "Maximum fee (₱, 0 = none)")}{field("hold_days", "Payout hold (days)")}{field("max_active", "Listings per seller")}
      </div>
      <div className="mt-3 flex justify-end"><button type="button" onClick={() => void save()} disabled={busy} className={BTN.gold}><BadgeCheck size={16} aria-hidden="true" />{busy ? tr("Saving…") : tr("Save terms")}</button></div>
    </section>
  );
}

export default function SellerPayouts({ onChanged }: { onChanged?: () => void }) {
  const superAdmin = canDelete();
  const [data, setData] = useState<PayoutList | null>(null);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState("");
  const [filter, setFilter] = useState<"" | PayoutState>("");
  const [paying, setPaying] = useState<PayoutRow | null>(null);
  const [viewing, setViewing] = useState("");

  const load = useCallback(() => {
    fetchPayouts().then((value) => { setData(value); setError(""); setSetup(""); }).catch((failure) => {
      if (failure instanceof SellerSetupError) setSetup(failure.message);
      else setError(failure instanceof Error ? failure.message : tr("Unable to load the seller payouts."));
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data?.payouts ?? []).filter((row) => !filter || row.state === filter), [data, filter]);
  const counts = useMemo(() => {
    const all = data?.payouts ?? [];
    return (Object.keys(STATE) as PayoutState[]).reduce((acc, key) => ({ ...acc, [key]: all.filter((row) => row.state === key).length }), {} as Record<PayoutState, number>);
  }, [data]);

  const openProof = async (row: PayoutRow) => {
    try { window.open(await fetchPayoutProofUrl(row.id), "_blank", "noopener"); } catch (failure) { showInfoModal({ variant: "error", title: tr("Transfer receipt"), message: failure instanceof Error ? failure.message : tr("It could not be opened.") }); }
  };

  if (setup) return <p role="status" className="rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-[14px] text-gold-900">{setup}</p>;
  const totals = data?.totals;
  return (
    <div className="space-y-4">
      <section className="glass-panel overflow-hidden" aria-label={tr("Seller payouts summary")}>
        <dl className="grid grid-cols-2 lg:grid-cols-4 [&>*]:border-line max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:divide-x lg:divide-line">
          {[
            { label: "Ready to pay", value: peso(totals?.ready ?? 0), hint: tr("{0} seller(s) past the hold period", { "0": totals?.ready_count ?? 0 }), icon: <HandCoins size={16} aria-hidden="true" /> },
            { label: "Held for sellers", value: peso(totals?.owed ?? 0), hint: tr("{0} payout(s) not sent yet", { "0": totals?.owed_count ?? 0 }), icon: <Hourglass size={16} aria-hidden="true" /> },
            { label: "Paid to sellers", value: peso(totals?.paid ?? 0), hint: tr("{0} payout receipt(s) issued", { "0": totals?.paid_count ?? 0 }), icon: <Wallet size={16} aria-hidden="true" /> },
            { label: "Commission earned", value: peso(totals?.commission ?? 0), hint: tr("From {0} in seller sales", { "0": peso(totals?.gross ?? 0) }), icon: <Percent size={16} aria-hidden="true" /> },
          ].map((stat) => (
            <div key={stat.label} className="px-5 py-4 sm:px-6 sm:py-5">
              <dt className="flex items-center gap-2 text-[13px] font-medium text-ink-muted"><span className="text-gold-600">{stat.icon}</span>{tr(stat.label)}</dt>
              <dd className="mt-1.5 font-[family-name:var(--font-heading)] text-[24px] font-semibold leading-none tabular-nums text-ink">{stat.value}</dd>
              <p className="mt-1.5 text-[12.5px] text-ink-muted">{stat.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      {superAdmin && data && <TermsCard key={JSON.stringify(data.terms)} terms={data.terms} onSaved={load} />}

      <SegmentedFilter label="Payout status" value={filter} onChange={setFilter}
        options={[{ value: "", label: "All", count: data?.payouts.length }, ...(["ready", "on_hold", "waiting_pickup", "paid", "cancelled"] as PayoutState[]).map((key) => ({ value: key, label: STATE[key].label, count: counts[key] }))]} />

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>}
      {!data && !error ? <AdminTableSkeleton rows={5} /> : (
        <DataTable caption={tr("Seller payouts")} minWidth={980}
          columns={[{ key: "item", label: "Item and seller" }, { key: "sale", label: "Sale" }, { key: "payout", label: "Payout", className: "text-right" }, { key: "to", label: "Send to" }, { key: "status", label: "Status" }, { key: "actions", label: "Actions" }]}
          isEmpty={rows.length === 0}
          empty={tr("No seller payouts here. A payout appears when you confirm the buyer's payment for a seller's item.")}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <span className="block font-semibold text-ink">{row.title}</span>
                <span className="block text-[12.5px] text-ink-muted">{row.seller.name || tr("Former user")}{row.seller.campus_id ? ` · ${row.seller.campus_id}` : ""}{row.buyer_name ? ` · ${tr("bought by {0}", { "0": row.buyer_name })}` : ""}</span>
              </td>
              <td className="text-[13.5px]"><span className="block tabular-nums">{peso(row.gross)}</span><span className="block text-[12.5px] text-ink-muted">{tr("fee {0} ({1}%)", { "0": peso(row.commission), "1": row.commission_rate })}</span></td>
              <td className="text-right font-semibold tabular-nums text-ink">{peso(row.payout_amount)}</td>
              <td className="text-[13.5px]"><span className="block">{tr(row.destination.label)}</span>{row.destination.account_number && <span className="block font-mono text-[12.5px] text-ink-muted">{row.destination.account_number}</span>}</td>
              <td>
                <StatusPill tone={STATE[row.state].tone}>{tr(STATE[row.state].label)}</StatusPill>
                <span className="mt-1 block text-[12px] text-ink-muted">
                  {row.state === "paid" && row.paid_at ? tr("{0} by {1}", { "0": formatDateTime(row.paid_at), "1": row.paid_by || tr("an administrator") })
                    : row.state === "on_hold" && row.ready_at ? tr("Payable from {0}", { "0": formatDateTime(row.ready_at) })
                      : row.state === "cancelled" ? row.cancelled_reason : row.state === "waiting_pickup" ? tr("The buyer has not collected it") : ""}
                </span>
              </td>
              <RowActions>
                {row.state === "ready" && <button type="button" onClick={() => setPaying(row)} className={`${BTN.gold} !min-h-[36px]`}><HandCoins size={15} aria-hidden="true" />{tr("Pay seller")}</button>}
                {row.status === "paid" && <button type="button" onClick={() => setViewing(row.id)} className={`${BTN.ghost} !min-h-[34px] !px-2.5 text-[13px]`}><ReceiptText size={14} aria-hidden="true" />{tr("Receipt")}</button>}
                {row.has_proof && <button type="button" onClick={() => void openProof(row)} className={`${BTN.ghost} !min-h-[34px] !px-2.5 text-[13px]`}><ImagePlus size={14} aria-hidden="true" />{tr("Transfer receipt")}</button>}
              </RowActions>
            </tr>
          ))}
        </DataTable>
      )}

      {paying && <PayModal row={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); load(); onChanged?.(); }} />}
      {viewing && <ReceiptModal kind="payout" id={viewing} onClose={() => setViewing("")} />}
    </div>
  );
}
