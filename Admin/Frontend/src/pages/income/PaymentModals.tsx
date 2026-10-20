import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Banknote, CheckCircle2, Printer, ReceiptText, RotateCcw, ShieldCheck } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT } from "../../components/ui/primitives";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { formatDateTime } from "../../utils/countdown";
import {
  confirmPayment, fetchEntryReceipt, fetchPaymentStatus, peso, printPaymentReceipt, reversePayment,
  type IncomeMethod, type PaymentReceipt, type PaymentStatus,
} from "../../utils/incomeApi";
import { tr } from "../../utils/preferences";

export const METHOD_LABEL: Record<IncomeMethod, string> = { cash: "Cash", gcash: "GCash", maya: "Maya", bank: "Bank transfer", other: "Other" };
const NEEDS_REFERENCE: IncomeMethod[] = ["gcash", "maya", "bank"];

/** What is being paid for. Amounts here are only shown: the server reads the real amount again and refuses a stale one. */
export interface PayableItem { source: "auction" | "smart_tag"; source_ref: string; title: string; amount: number; payer_name: string; released?: boolean }

function Line({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[12.5px] font-medium text-ink-muted">{label}</dt><dd className="mt-0.5 break-words text-[14.5px] font-semibold text-ink">{value}</dd></div>;
}

/** The receipt as the administrator and the payer see it. The code is what makes it checkable, so it sits right under the number. */
export function ReceiptCard({ receipt }: { receipt: PaymentReceipt }) {
  const print = () => { if (!printPaymentReceipt(receipt)) showInfoModal({ variant: "warning", title: tr("Pop-up blocked"), message: tr("Allow pop-ups for this site, then press Print again.") }); };
  return (
    <article className="overflow-hidden rounded-2xl border border-navy-800/25 bg-[var(--surface)]" aria-label={tr("Receipt {0}", { "0": receipt.receipt_no })}>
      <header className="border-b-4 border-gold-400 bg-[linear-gradient(135deg,#22366a_0%,#162448_100%)] px-5 py-4 text-white">
        <p className="text-[12.5px] font-semibold text-gold-300">{tr("University of Makati - Lost and Found Office")}</p>
        <h3 className="mt-0.5 font-[family-name:var(--font-heading)] text-[21px] font-semibold">{tr("Official payment receipt")}</h3>
      </header>
      <div className="space-y-4 p-5">
        {receipt.reversed && <p className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-[13.5px] font-semibold text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">{tr("This payment was reversed. The receipt is no longer valid.")}</p>}
        <div><p className="text-[12.5px] font-medium text-ink-muted">{tr("Receipt number")}</p><p className="select-all break-all font-mono text-[20px] font-medium text-navy-800 dark:text-gold-300">{receipt.receipt_no}</p></div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-dashed border-gold-400 bg-gold-50 px-4 py-3 dark:bg-gold-500/10">
          <p className="text-[12.5px] font-semibold text-gold-800 dark:text-gold-300">{tr("Verification code")}</p>
          <p className="select-all font-mono text-[21px] font-medium tracking-[0.12em] text-navy-800 dark:text-gold-200">{receipt.code}</p>
        </div>
        <dl className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
          <Line label={tr("Item")} value={receipt.item.name} />
          <Line label={tr("Amount received")} value={peso(receipt.amount)} />
          <Line label={tr("Received from")} value={receipt.released_to || "-"} />
          <Line label={tr("Paid by")} value={tr(METHOD_LABEL[receipt.method] ?? receipt.method)} />
          {receipt.payment_reference && <Line label={tr("Payment reference")} value={receipt.payment_reference} />}
          <Line label={tr("Date and time")} value={formatDateTime(receipt.released_at)} />
          <Line label={tr("Received by")} value={receipt.released_by} />
        </dl>
        <button type="button" onClick={print} className={`${BTN.primary} w-full`}><Printer size={16} aria-hidden="true" />{tr("Print or save as PDF")}</button>
      </div>
    </article>
  );
}

/** Confirm that the money was received. This is the ONLY step that turns an auction or Smart Tag sale into income, and it issues the receipt. */
export function ConfirmPaymentModal({ item, onClose, onConfirmed }: { item: PayableItem; onClose: () => void; onConfirmed: (receipt: PaymentReceipt) => void }) {
  const [method, setMethod] = useState<IncomeMethod>("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [received, setReceived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const needsReference = NEEDS_REFERENCE.includes(method);
  const valid = received && (!needsReference || reference.trim().length >= 4);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setError("");
    try {
      const result = await confirmPayment({ source: item.source, source_ref: item.source_ref, method, reference: reference.trim(), notes: notes.trim(), expected_amount: item.amount });
      setReceipt(result.receipt);
      onConfirmed(result.receipt);
    } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to confirm the payment.")); } finally { setBusy(false); }
  };

  if (receipt) {
    return (
      <AdminModal title={tr("Payment confirmed")} description={tr("The amount now counts as income. The payer was notified and can see this receipt in My receipts.")} icon={<BadgeCheck size={19} />} tone="mint" size="md" onClose={onClose}
        footer={<button type="button" onClick={onClose} className={BTN.ghost}>{tr("Done")}</button>}>
        <ReceiptCard receipt={receipt} />
      </AdminModal>
    );
  }
  return (
    <AdminModal title={tr("Confirm payment")} description={tr("Money counts as income only after you confirm it was received. A receipt is issued to the payer.")} icon={<Banknote size={19} />} tone="gold" size="md" busy={busy} onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
          <button type="button" onClick={() => void submit()} disabled={!valid || busy} className={BTN.primary}><ShieldCheck size={16} aria-hidden="true" />{busy ? tr("Confirming…") : tr("Confirm payment and issue receipt")}</button>
        </>
      )}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-line bg-frost-50 p-4 dark:bg-white/[0.04]">
          <p className="text-[13px] text-ink-muted">{item.source === "auction" ? tr("Auction Hall") : tr("Smart Tag")} · {item.title}</p>
          <p className="mt-1 font-[family-name:var(--font-heading)] text-[32px] font-semibold leading-none tabular-nums text-ink">{peso(item.amount)}</p>
          <p className="mt-2 text-[13.5px] text-ink-soft">{tr("Payer: {0}", { "0": item.payer_name || tr("Unknown") })}</p>
          {item.released && <p className="mt-2 rounded-lg bg-gold-50 px-3 py-2 text-[13px] font-medium text-gold-800 dark:bg-gold-500/10 dark:text-gold-200">{tr("This item was already handed over. Confirm only if the payment was really received.")}</p>}
        </div>
        <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("How was it paid?")}</span>
          <select value={method} onChange={(event) => setMethod(event.target.value as IncomeMethod)} className={INPUT}>
            {(Object.keys(METHOD_LABEL) as IncomeMethod[]).map((key) => <option key={key} value={key}>{tr(METHOD_LABEL[key])}</option>)}
          </select>
        </label>
        {needsReference && (
          <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Payment reference number")}</span>
            <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={64} autoComplete="off" className={INPUT} placeholder={tr("From the payer's payment confirmation")} aria-invalid={reference.length > 0 && reference.trim().length < 4} />
            <span className="mt-1 block text-[12.5px] text-ink-muted">{tr("Check it against the payer's screenshot or the bank record. It is kept with the receipt.")}</span>
          </label>
        )}
        <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Notes (optional)")}</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} rows={2} className={`${INPUT} py-2.5`} /></label>
        <label className="flex items-start gap-3 rounded-xl border border-gold-300 bg-gold-50/70 p-3.5 text-[14px] leading-5 text-ink-soft dark:border-gold-500/30 dark:bg-gold-500/[0.07]">
          <input type="checkbox" checked={received} onChange={(event) => setReceived(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-navy-800" />
          {tr("I received {0} from {1} and checked it against the payment proof.", { "0": peso(item.amount), "1": item.payer_name || tr("the payer") })}
        </label>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">{error}</p>}
      </div>
    </AdminModal>
  );
}

/** Super admins: reverse a confirmed payment. The ledger gets a linked refund, the receipt is marked reversed, nothing is deleted. */
export function ReverseModal({ entryId, receiptNo, amount, onClose, onDone }: { entryId: string; receiptNo: string; amount: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = sure && reason.trim().length >= 8;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setError("");
    try { await reversePayment(entryId, reason.trim()); onDone(); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to reverse the payment.")); } finally { setBusy(false); }
  };
  return (
    <AdminModal title={tr("Reverse this payment")} description={tr("Use this when a payment was confirmed by mistake or the money was given back. The record stays: a linked refund is added.")} icon={<RotateCcw size={19} />} tone="danger" size="sm" busy={busy} onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
          <button type="button" onClick={() => void submit()} disabled={!valid || busy} className={BTN.danger}>{busy ? tr("Reversing…") : tr("Reverse payment")}</button>
        </>
      )}>
      <div className="space-y-4">
        <p className="rounded-xl bg-frost-50 px-3.5 py-2.5 text-[14px] text-ink-soft dark:bg-white/[0.04]">{tr("Receipt {0}, {1}. It will stop being valid and the payer will be told.", { "0": receiptNo, "1": peso(amount) })}</p>
        <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Reason")}</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={3} className={`${INPUT} py-2.5`} placeholder={tr("Why is this being reversed? It stays in the record.")} />
          {reason.trim().length > 0 && reason.trim().length < 8 && <span className="mt-1 block text-[12.5px] text-rose-600">{tr("Write at least 8 characters.")}</span>}</label>
        <label className="flex items-start gap-3 text-[14px] leading-5 text-ink-soft"><input type="checkbox" checked={sure} onChange={(event) => setSure(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-navy-800" />{tr("I understand a reversal cannot be undone.")}</label>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{error}</p>}
      </div>
    </AdminModal>
  );
}

/** Opens one confirmed payment's receipt. */
export function ReceiptModal({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetchEntryReceipt(entryId).then(setReceipt).catch((failure) => setError(failure instanceof Error ? failure.message : tr("Unable to load the receipt."))); }, [entryId]);
  return (
    <AdminModal title={tr("Payment receipt")} icon={<ReceiptText size={19} />} tone="navy" size="md" onClose={onClose} footer={<button type="button" onClick={onClose} className={BTN.ghost}>{tr("Close")}</button>}>
      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{error}</p> : receipt ? <ReceiptCard receipt={receipt} /> : <SkeletonBlock className="h-72 w-full rounded-2xl" />}
    </AdminModal>
  );
}

/** For the Auctions and Smart Tags pages: shows whether an item is paid, and lets an administrator confirm it right there. */
export function PaymentStatusChip({ source, refId, onChanged }: { source: "auction" | "smart_tag"; refId: string; onChanged?: () => void }) {
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [confirming, setConfirming] = useState<PayableItem | null>(null);
  const [viewing, setViewing] = useState("");
  const load = useCallback(() => { fetchPaymentStatus(source, refId).then(setStatus).catch(() => setStatus(null)); }, [source, refId]);
  useEffect(() => { load(); }, [load]);
  if (!status || status.state === "none") return null;
  return (
    <>
      {status.state === "confirmed" ? (
        <button type="button" onClick={() => setViewing(status.entry_id)} className="inline-flex items-center gap-1.5 rounded-full border border-tide-200 bg-tide-50 px-3 py-1.5 text-[13px] font-semibold text-tide-700 dark:border-tide-500/30 dark:bg-tide-500/10 dark:text-tide-300">
          <CheckCircle2 size={14} aria-hidden="true" />{tr("Paid {0}", { "0": peso(status.amount) })} · {status.receipt_no}
        </button>
      ) : (
        <button type="button" onClick={() => setConfirming({ source, source_ref: refId, title: status.title, amount: status.amount, payer_name: status.payer_name, released: status.released })} className={`${BTN.gold} !min-h-[38px]`}>
          <Banknote size={15} aria-hidden="true" />{tr("Confirm payment {0}", { "0": peso(status.amount) })}
        </button>
      )}
      {confirming && <ConfirmPaymentModal item={confirming} onClose={() => { setConfirming(null); load(); onChanged?.(); }} onConfirmed={() => load()} />}
      {viewing && <ReceiptModal entryId={viewing} onClose={() => setViewing("")} />}
    </>
  );
}
