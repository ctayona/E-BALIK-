import { useCallback, useEffect, useState } from "react";
import { Banknote, CheckCircle2, Clock3, ImagePlus, Send, XCircle } from "lucide-react";
import PhotoSourceButtons from "@/app/shared/PhotoSourceButtons";
import { CX } from "@/app/utils/clay";
import { PAY_METHODS, paymentsApi, shrinkReceipt, type DueItem, type MyPayments, type PayMethod } from "@/app/utils/payments";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

const peso = (value: number) => `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * What you owe for an auction win or a Smart Tag, how to pay, and sending the receipt of a GCash, Maya or bank payment.
 * Money counts only after the office checks your receipt and confirms the payment; then your official receipt appears in My receipts.
 * It shows nothing when there is nothing to pay.
 */
export default function PaymentCard({ source, refId }: { source: "auction" | "smart_tag"; refId: string }) {
  const [data, setData] = useState<MyPayments | null>(null);
  const [method, setMethod] = useState<PayMethod>("gcash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [resending, setResending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => { paymentsApi.mine().then(setData).catch(() => setData(null)); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const due: DueItem | undefined = data?.items.find((item) => item.source === source && item.source_ref === refId);
  if (!data || !due) return null;
  const proof = due.proof;
  const waiting = proof?.status === "pending" && !resending;
  const rejected = proof?.status === "rejected";
  const needsReference = method !== "other";
  const valid = Boolean(image) && (!needsReference || reference.trim().length >= 4);

  const pick = async (file: File) => {
    if (!/^image\//.test(file.type)) { setError("Choose a picture of your payment receipt (JPG, PNG or WEBP)."); return; }
    setError("");
    const small = await shrinkReceipt(file);
    if (preview) URL.revokeObjectURL(preview);
    setImage(small); setPreview(URL.createObjectURL(small));
  };

  const send = async () => {
    if (!valid || !image || busy) return;
    setBusy(true); setError("");
    try {
      const result = await paymentsApi.sendProof({ source, source_ref: refId, method, reference: reference.trim(), note: note.trim(), image });
      showInfoModal({ variant: "success", title: "Receipt sent", message: result.message });
      setImage(null); setPreview(""); setReference(""); setNote(""); setResending(false);
      load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to send the receipt."); } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-gold-300 bg-gold-50/70 p-4 text-ink" aria-label="Payment">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><Banknote size={19} /></span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-gold-800">Amount to pay</p>
          <p className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-none tabular-nums text-navy-800">{peso(due.amount)}</p>
        </div>
      </div>

      {data.instructions ? <p className="whitespace-pre-line rounded-xl bg-white/70 px-3.5 py-3 text-[13.5px] leading-6 text-ink-soft">{data.instructions}</p>
        : <p className="rounded-xl bg-white/70 px-3.5 py-3 text-[13.5px] leading-6 text-ink-soft">Pay at the Lost and Found Office, or pay by GCash, Maya or bank transfer and send your receipt below.</p>}

      {waiting && proof && (
        <div className="flex items-start gap-2.5 rounded-xl border border-iris-300 bg-iris-50 px-3.5 py-3 text-[13.5px] leading-5 text-iris-800" role="status">
          <Clock3 size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Your receipt is with the office</p>
            <p>Sent {new Date(proof.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, reference {proof.reference || "none"}. You will get your official receipt here and by email once the payment is confirmed.</p>
            <button type="button" onClick={() => setResending(true)} className="mt-1 font-semibold underline">Send a different receipt</button>
          </div>
        </div>
      )}

      {rejected && proof && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-[13.5px] leading-5 text-rose-800" role="alert">
          <XCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div><p className="font-semibold">The office could not accept your receipt</p><p>{proof.review_note || "Please send a clearer receipt."} Send another one below.</p></div>
        </div>
      )}

      {!waiting && (
        <div className="space-y-3">
          <h3 className="text-[14px] font-semibold text-navy-800">Paid by GCash, Maya or bank? Send your receipt</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={CX.label}>Paid with</span>
              <select value={method} onChange={(event) => setMethod(event.target.value as PayMethod)} className={`${CX.input} w-full`}>{PAY_METHODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="block"><span className={CX.label}>Reference number</span>
              <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={64} autoComplete="off" inputMode="text" className={`${CX.input} w-full font-mono`} placeholder="From your receipt" aria-describedby="pay-ref-hint" /></label>
          </div>
          <p id="pay-ref-hint" className={CX.helper}>{PAY_METHODS.find((option) => option.value === method)?.hint}</p>
          {preview ? (
            <div className="relative overflow-hidden rounded-2xl border border-line bg-white">
              <img src={preview} alt="Your payment receipt" className="max-h-64 w-full object-contain p-2" />
              <button type="button" onClick={() => { setImage(null); setPreview(""); }} className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-full bg-navy-900/80 text-white" aria-label="Remove the receipt picture"><XCircle size={16} aria-hidden="true" /></button>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-line-strong bg-white/60 p-3">
              <p className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold text-navy-800"><ImagePlus size={16} aria-hidden="true" />Picture of your payment receipt</p>
              <PhotoSourceButtons onFile={(file) => void pick(file)} disabled={busy} />
            </div>
          )}
          <label className="block"><span className={CX.label}>Note for the office (optional)</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} className={`${CX.input} w-full`} /></label>
          {error && <p role="alert" className={CX.alertError}>{error}</p>}
          <button type="button" onClick={() => void send()} disabled={!valid || busy} className={`${CX.btnNavy} w-full`}><Send size={16} aria-hidden="true" />{busy ? "Sending..." : "Send receipt to the office"}</button>
          <p className="flex items-start gap-1.5 text-[12.5px] leading-5 text-ink-muted"><CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Your payment counts only after the office checks the receipt and confirms it. Paying in cash? Just pay at the office: no receipt needed here.</p>
        </div>
      )}
    </section>
  );
}
