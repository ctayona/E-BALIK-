import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Banknote, CheckCircle2, History as HistoryIcon, ImagePlus, Mail, Maximize2, Printer, ReceiptText, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT } from "../../components/ui/primitives";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { formatDateTime } from "../../utils/countdown";
import { canDelete } from "../../utils/permissions";
import {
  confirmPayment, fetchEntryProofUrl, fetchPaymentStatus, fetchProofUrl, fetchReceiptDetail, peso, printPaymentReceipt, rejectProof, resendReceipt, reversePayment,
  type IncomeMethod, type PaymentProof, type PaymentReceipt, type PaymentStatus, type ReceiptHistory,
} from "../../utils/incomeApi";
import { tr } from "../../utils/preferences";

export const METHOD_LABEL: Record<IncomeMethod, string> = { cash: "Cash", gcash: "GCash", maya: "Maya", bank: "Bank transfer", other: "Other" };
const NEEDS_REFERENCE: IncomeMethod[] = ["gcash", "maya", "bank"];

/** What is being paid for. Amounts here are only shown: the server reads the real amount again and refuses a stale one. */
export interface PayableItem { source: "auction" | "smart_tag"; source_ref: string; title: string; amount: number; payer_name: string; released?: boolean; proof?: PaymentProof | null }

function Line({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[12.5px] font-medium text-ink-muted">{label}</dt><dd className="mt-0.5 break-words text-[14.5px] font-semibold text-ink">{value}</dd></div>;
}

/** A private image (the payer's receipt) loaded through a short-lived link, with a button to open it full size. */
function ProofImage({ load, label }: { load: () => Promise<string>; label: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; load().then((value) => { if (live) setUrl(value); }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, [load]);
  if (failed) return <p className="rounded-xl border border-line px-3.5 py-3 text-[13px] text-ink-muted">{tr("The image could not be loaded. Close this window and try again.")}</p>;
  if (!url) return <SkeletonBlock className="h-44 w-full rounded-2xl" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-2xl border border-line bg-frost-50 dark:bg-white/[0.04]" aria-label={tr("Open {0} full size", { "0": label })}>
      <img src={url} alt={label} className="max-h-72 w-full object-contain p-2" />
      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-navy-900/80 px-2.5 py-1 text-[12px] font-semibold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Maximize2 size={12} aria-hidden="true" />{tr("Full size")}</span>
    </a>
  );
}

/** The receipt as the administrator and the payer see it. The code is what makes it checkable, so it sits right under the number. */
export function ReceiptCard({ receipt }: { receipt: PaymentReceipt }) {
  const print = () => { if (!printPaymentReceipt(receipt)) showInfoModal({ variant: "warning", title: tr("Pop-up blocked"), message: tr("Allow pop-ups for this site, then press Print again.") }); };
  const payment = receipt.kind === "payment";
  const title = payment ? tr("Official payment receipt") : receipt.kind === "auction" ? tr("Auction collection receipt") : tr("Handover receipt");
  return (
    <article className="overflow-hidden rounded-2xl border border-navy-800/25 bg-[var(--surface)]" aria-label={tr("Receipt {0}", { "0": receipt.receipt_no })}>
      <header className="border-b-4 border-gold-400 bg-[linear-gradient(135deg,#22366a_0%,#162448_100%)] px-5 py-4 text-white">
        <p className="text-[12.5px] font-semibold text-gold-300">{tr("University of Makati - Lost and Found Office")}</p>
        <h3 className="mt-0.5 font-[family-name:var(--font-heading)] text-[21px] font-semibold">{title}</h3>
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
          {receipt.amount ? <Line label={payment ? tr("Amount received") : tr("Amount paid")} value={peso(receipt.amount)} /> : null}
          <Line label={payment ? tr("Received from") : tr("Released to")} value={receipt.released_to || "-"} />
          {payment && receipt.method && <Line label={tr("Paid by")} value={tr(METHOD_LABEL[receipt.method] ?? receipt.method)} />}
          {receipt.payment_reference && <Line label={tr("Payment reference")} value={receipt.payment_reference} />}
          <Line label={tr("Date and time")} value={formatDateTime(receipt.released_at)} />
          <Line label={payment ? tr("Received by") : tr("Released by")} value={receipt.released_by} />
        </dl>
        <button type="button" onClick={print} className={`${BTN.primary} w-full`}><Printer size={16} aria-hidden="true" />{tr("Print or save as PDF")}</button>
      </div>
    </article>
  );
}

/** Confirm that the money was received. This is the ONLY step that turns an auction or Smart Tag sale into income, and it issues the receipt. */
export function ConfirmPaymentModal({ item, onClose, onConfirmed }: { item: PayableItem; onClose: () => void; onConfirmed: (receipt: PaymentReceipt) => void }) {
  const sent = item.proof && item.proof.status === "pending" ? item.proof : null;      // the receipt image the payer already sent
  const [method, setMethod] = useState<IncomeMethod>(sent && sent.method !== "other" ? sent.method : "cash");
  const [reference, setReference] = useState(sent?.reference ?? "");
  const [notes, setNotes] = useState("");
  const [useSent, setUseSent] = useState(Boolean(sent));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [received, setReceived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const needsProof = NEEDS_REFERENCE.includes(method);
  const hasProof = (useSent && Boolean(sent)) || Boolean(file);
  const valid = received && (!needsProof || (reference.trim().length >= 4 && hasProof));
  const loadSent = useCallback(() => fetchProofUrl(sent!.proof_id), [sent]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choose = (picked: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    if (picked && !/^image\/(jpeg|png|webp)$/.test(picked.type)) { setError(tr("The payment receipt must be a JPG, PNG or WEBP image.")); return; }
    if (picked && picked.size > 5 * 1024 * 1024) { setError(tr("That image is larger than 5 MB. Use a smaller screenshot.")); return; }
    setError(""); setFile(picked); setPreview(picked ? URL.createObjectURL(picked) : ""); if (picked) setUseSent(false);
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setError("");
    try {
      const result = await confirmPayment({ source: item.source, source_ref: item.source_ref, method, reference: reference.trim(), notes: notes.trim(), expected_amount: item.amount,
        proofFile: useSent ? null : file, proofId: useSent && sent ? sent.proof_id : null });
      setReceipt(result.receipt);
      onConfirmed(result.receipt);
    } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to confirm the payment.")); } finally { setBusy(false); }
  };

  const reject = async () => {
    if (!sent || reason.trim().length < 4 || busy) return;
    setBusy(true); setError("");
    try { await rejectProof(sent.proof_id, reason.trim()); onClose(); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to reject the receipt.")); } finally { setBusy(false); }
  };

  if (receipt) {
    return (
      <AdminModal title={tr("Payment confirmed")} description={tr("The amount now counts as revenue. The payer was notified and can see this receipt in My receipts.")} icon={<BadgeCheck size={19} />} tone="mint" size="md" onClose={onClose}
        footer={<button type="button" onClick={onClose} className={BTN.ghost}>{tr("Done")}</button>}>
        <ReceiptCard receipt={receipt} />
      </AdminModal>
    );
  }
  return (
    <AdminModal title={tr("Confirm payment")} description={tr("Money counts as revenue only after you confirm it was received. A receipt is issued to the payer.")} icon={<Banknote size={19} />} tone="gold" size="md" busy={busy} onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
          <button type="button" onClick={() => void submit()} disabled={!valid || busy || rejecting} className={BTN.primary}><ShieldCheck size={16} aria-hidden="true" />{busy ? tr("Confirming…") : tr("Confirm payment and issue receipt")}</button>
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

        {needsProof && (
          <>
            <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Payment reference number")}</span>
              <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={64} autoComplete="off" className={INPUT} placeholder={tr("From the payer's payment confirmation")} aria-invalid={reference.length > 0 && reference.trim().length < 4} />
            </label>

            <section className="space-y-3 rounded-2xl border border-line p-4" aria-label={tr("Payment receipt image")}>
              <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink"><ImagePlus size={16} aria-hidden="true" />{tr("Payer's payment receipt")}</h3>
              {sent && useSent && !rejecting && (
                <>
                  <p className="text-[13px] text-ink-muted">{tr("The payer sent this receipt {0}{1}. Check the amount, the reference and the account name before confirming.", { "0": formatDateTime(sent.created_at), "1": sent.note ? `: "${sent.note}"` : "" })}</p>
                  <ProofImage load={loadSent} label={tr("Payment receipt sent by the payer")} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setRejecting(true)} className={`${BTN.ghost} !min-h-[36px] text-[13px]`}><XCircle size={14} aria-hidden="true" />{tr("This receipt is not acceptable")}</button>
                    <button type="button" onClick={() => setUseSent(false)} className={`${BTN.ghost} !min-h-[36px] text-[13px]`}>{tr("Attach a different image")}</button>
                  </div>
                </>
              )}
              {sent && rejecting && (
                <div className="space-y-2">
                  <label className="block"><span className="mb-1.5 block text-[13.5px] font-semibold text-ink-soft">{tr("What is wrong with it? The payer is told and can send another.")}</span>
                    <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={2} className={`${INPUT} py-2.5`} placeholder={tr("For example: the amount on the receipt is 250, not 300")} /></label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setRejecting(false)} disabled={busy} className={`${BTN.ghost} !min-h-[36px] text-[13px]`}>{tr("Back")}</button>
                    <button type="button" onClick={() => void reject()} disabled={busy || reason.trim().length < 4} className={`${BTN.danger} !min-h-[36px] text-[13px]`}>{busy ? tr("Sending…") : tr("Reject and tell the payer")}</button>
                  </div>
                </div>
              )}
              {(!sent || !useSent) && (
                <div className="space-y-2">
                  {preview ? (
                    <div className="relative overflow-hidden rounded-2xl border border-line bg-frost-50 dark:bg-white/[0.04]">
                      <img src={preview} alt={tr("The receipt you attached")} className="max-h-60 w-full object-contain p-2" />
                      <button type="button" onClick={() => choose(null)} className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-full bg-navy-900/80 text-white" aria-label={tr("Remove the image")}><XCircle size={16} aria-hidden="true" /></button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-line-strong bg-frost-50/60 px-4 py-6 text-center transition hover:border-iris-300 dark:bg-white/[0.03]">
                      <ImagePlus size={22} className="text-navy-700 dark:text-gold-300" aria-hidden="true" />
                      <span className="text-[14px] font-semibold text-ink">{tr("Attach the payer's receipt")}</span>
                      <span className="text-[12.5px] text-ink-muted">{tr("A screenshot or photo of the GCash, Maya or bank receipt. JPG, PNG or WEBP, up to 5 MB.")}</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} />
                    </label>
                  )}
                  {sent && <button type="button" onClick={() => { choose(null); setUseSent(true); }} className="text-[13px] font-semibold text-iris-700 underline dark:text-iris-300">{tr("Use the receipt the payer sent instead")}</button>}
                </div>
              )}
            </section>
          </>
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

/** One receipt of any kind, with what the office did with it, the payment receipt image kept with it, and (for payments) re-send and reverse. */
export function ReceiptModal({ kind, id, onClose, onChanged }: { kind: "payment" | "claim" | "auction"; id: string; onClose: () => void; onChanged?: () => void }) {
  const superAdmin = canDelete();
  const [data, setData] = useState<{ receipt: PaymentReceipt; history: ReceiptHistory[] } | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [reversing, setReversing] = useState(false);
  const load = useCallback(() => { fetchReceiptDetail(kind, id).then(setData).catch((failure) => setError(failure instanceof Error ? failure.message : tr("Unable to load the receipt."))); }, [kind, id]);
  useEffect(() => { load(); }, [load]);
  const receipt = data?.receipt;
  const loadProof = useCallback(() => fetchEntryProofUrl(id), [id]);

  const resend = async () => {
    setSending(true);
    try { await resendReceipt(id); showInfoModal({ variant: "success", title: tr("Receipt sent"), message: tr("The receipt was emailed to the payer again.") }); load(); } catch (failure) { showInfoModal({ variant: "error", title: tr("Not sent"), message: failure instanceof Error ? failure.message : tr("Unable to send the receipt.") }); } finally { setSending(false); }
  };

  return (
    <AdminModal title={tr("Receipt")} icon={<ReceiptText size={19} />} tone="navy" size="lg" onClose={onClose}
      footer={(
        <>
          {receipt && kind === "payment" && !receipt.reversed && <button type="button" onClick={() => void resend()} disabled={sending} className={BTN.ghost}><Mail size={16} aria-hidden="true" />{sending ? tr("Sending…") : tr("Email it again")}</button>}
          {receipt && kind === "payment" && !receipt.reversed && superAdmin && <button type="button" onClick={() => setReversing(true)} className={BTN.ghost}><RotateCcw size={16} aria-hidden="true" />{tr("Reverse payment")}</button>}
          <button type="button" onClick={onClose} className={BTN.ghost}>{tr("Close")}</button>
        </>
      )}>
      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{error}</p> : !receipt ? <SkeletonBlock className="h-72 w-full rounded-2xl" /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <ReceiptCard receipt={receipt} />
          <div className="space-y-5">
            {kind === "payment" && (
              <section className="space-y-2" aria-label={tr("Payment receipt image")}>
                <h3 className="text-[14px] font-semibold text-ink">{tr("Payer's payment receipt")}</h3>
                {receipt.has_proof ? <ProofImage load={loadProof} label={tr("Payment receipt kept with this payment")} /> : <p className="rounded-xl border border-dashed border-line-strong px-3.5 py-3 text-[13px] text-ink-muted">{receipt.method === "cash" ? tr("Paid in cash at the office: no image needed.") : tr("No image was kept with this payment.")}</p>}
              </section>
            )}
            <section className="space-y-2" aria-label={tr("Receipt history")}>
              <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink"><HistoryIcon size={15} aria-hidden="true" />{tr("History")}</h3>
              {data && data.history.length === 0 ? <p className="text-[13px] text-ink-muted">{tr("Nothing has been recorded for this receipt yet beyond when it was issued.")}</p> : (
                <ol className="space-y-2.5 border-l-2 border-line pl-4">
                  {data?.history.map((event, index) => (
                    <li key={`${event.at}-${index}`} className="relative text-[13.5px]">
                      <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-navy-700 dark:bg-gold-400" aria-hidden="true" />
                      <p className="font-semibold text-ink">{event.action}{event.result === "failed" ? ` (${tr("failed")})` : ""}</p>
                      <p className="text-[12.5px] text-ink-muted">{event.who || tr("System")} · {formatDateTime(event.at)}</p>
                      {event.details && <p className="text-[12.5px] text-ink-soft">{event.details}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      )}
      {reversing && receipt && <ReverseModal entryId={id} receiptNo={receipt.receipt_no} amount={receipt.amount ?? 0} onClose={() => setReversing(false)} onDone={() => { setReversing(false); load(); onChanged?.(); }} />}
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
        <button type="button" onClick={() => setConfirming({ source, source_ref: refId, title: status.title, amount: status.amount, payer_name: status.payer_name, released: status.released, proof: status.proof })} className={`${BTN.gold} !min-h-[38px]`}>
          <Banknote size={15} aria-hidden="true" />{status.proof ? tr("Review receipt and confirm {0}", { "0": peso(status.amount) }) : tr("Confirm payment {0}", { "0": peso(status.amount) })}
        </button>
      )}
      {confirming && <ConfirmPaymentModal item={confirming} onClose={() => { setConfirming(null); load(); }} onConfirmed={() => { load(); onChanged?.(); }} />}
      {viewing && <ReceiptModal kind="payment" id={viewing} onClose={() => setViewing("")} onChanged={() => { load(); onChanged?.(); }} />}
    </>
  );
}
