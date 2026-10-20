import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BadgeCheck, Check, Copy, Gavel, PackageCheck, Printer, Receipt as ReceiptIcon, SearchX, ShieldCheck } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { CX } from "@/app/utils/clay";
import { ReportGridSkeleton } from "@/app/shared/LoadingSkeleton";
import { manilaDateTime, pesoText, printReceipt, receiptsApi, type Receipt, type ReceiptCheck } from "@/app/utils/receipts";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

type Tab = "mine" | "check";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[14.5px] font-semibold text-ink">{value}</dd>
    </div>
  );
}

/** The receipt itself: what the owner shows, prints or saves. The code is what makes it checkable, so it is the most prominent thing after the number. */
function Sheet({ receipt }: { receipt: Receipt }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${receipt.receipt_no}  ${receipt.code}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* the number is on screen to copy by hand */ }
  };
  return (
    <article className="overflow-hidden rounded-2xl border border-navy-800/25 bg-white shadow-card" aria-label={`Receipt ${receipt.receipt_no}`}>
      <header className="border-b-4 border-gold-400 bg-[linear-gradient(135deg,#22366a_0%,#162448_100%)] px-5 py-4 text-white">
        <p className="text-[12.5px] font-semibold text-gold-300">University of Makati - Lost and Found Office</p>
        <h3 className="mt-0.5 text-[22px] font-semibold" style={{ fontFamily: "var(--font-heading)" }}>{receipt.kind === "auction" ? "Auction collection receipt" : "Handover receipt"}</h3>
      </header>
      <div className="space-y-4 p-5">
        <div>
          <p className="text-[12.5px] font-medium text-ink-muted">Receipt number</p>
          <p className="select-all break-all font-mono text-[20px] font-medium text-navy-800 sm:text-[22px]">{receipt.receipt_no}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-dashed border-gold-400 bg-gold-50 px-4 py-3">
          <p className="text-[12.5px] font-semibold text-gold-800">Verification code</p>
          <p className="select-all font-mono text-[22px] font-medium tracking-[0.12em] text-navy-800">{receipt.code}</p>
        </div>
        <dl className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
          <Row label="Item" value={receipt.item.name} />
          {receipt.item.reference && <Row label="Item reference" value={receipt.item.reference} />}
          {receipt.item.found_at && <Row label="Found at" value={receipt.item.found_at} />}
          <Row label="Released to" value={receipt.released_to || "-"} />
          {receipt.campus_id && <Row label="Campus ID" value={receipt.campus_id} />}
          <Row label="Released by" value={receipt.released_by} />
          <Row label="Date and time" value={manilaDateTime(receipt.released_at)} />
          {receipt.amount ? <Row label="Amount paid" value={pesoText(receipt.amount)} /> : null}
        </dl>
        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row">
          <button type="button" onClick={() => void copy()} className={`${CX.btnGhost} flex-1`}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? "Copied" : "Copy number and code"}</button>
          <button
            type="button"
            onClick={() => { if (!printReceipt(receipt)) showInfoModal({ variant: "warning", title: "Pop-up blocked", message: "Allow pop-ups for this site, then press Print again." }); }}
            className={`${CX.btnNavy} flex-1`}
          ><Printer size={16} aria-hidden="true" />Print or save as PDF</button>
        </div>
        <p className="text-[12.5px] leading-5 text-ink-muted">Anyone who has the receipt number and code can check that it is genuine. They see only the item and the day, never your name.</p>
      </div>
    </article>
  );
}

function Check_({ result }: { result: ReceiptCheck }) {
  return result.valid ? (
    <div className="flex items-start gap-3 rounded-2xl border border-tide-200 bg-tide-50 p-4" role="status">
      <BadgeCheck size={22} className="mt-0.5 shrink-0 text-tide-700" aria-hidden="true" />
      <div>
        <p className="text-[15px] font-semibold text-tide-700">This receipt is genuine</p>
        <p className="mt-0.5 text-[14px] leading-5 text-ink-soft"><span className="font-semibold text-ink">{result.item_name}</span> was {result.kind === "auction" ? "collected from the Auction Hall" : "released to its owner"} on {result.released_on}.</p>
      </div>
    </div>
  ) : (
    <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4" role="status">
      <SearchX size={22} className="mt-0.5 shrink-0 text-rose-700" aria-hidden="true" />
      <div>
        <p className="text-[15px] font-semibold text-rose-800">No receipt matches</p>
        <p className="mt-0.5 text-[14px] leading-5 text-rose-800/90">The number and code do not go together. Check for a mistyped character, or ask the person to show the receipt at the Lost and Found Office.</p>
      </div>
    </div>
  );
}

export default function ReceiptsModal({ open, onClose, focusReference = "" }: { open: boolean; onClose: () => void; focusReference?: string }) {
  const [tab, setTab] = useState<Tab>("mine");
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ReceiptCheck | null>(null);
  const [checkError, setCheckError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const list = await receiptsApi.mine();
      setReceipts(list);
      if (focusReference) setSelected(list.find((r) => r.reference === focusReference) ?? null);
    } catch (failure) {
      setReceipts([]);
      setError(failure instanceof Error ? failure.message : "Unable to load your receipts.");
    }
  }, [focusReference]);

  useEffect(() => {
    if (!open) return;
    setTab("mine"); setSelected(null); setResult(null); setCheckError(""); setReceipts(null);
    void load();
  }, [open, load]);

  const check = async () => {
    if (checking || !number.trim() || !code.trim()) return;
    setChecking(true); setResult(null); setCheckError("");
    try { setResult(await receiptsApi.check(number.trim(), code.trim())); } catch (failure) { setCheckError(failure instanceof Error ? failure.message : "Unable to check the receipt."); } finally { setChecking(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      tone="gold"
      size="md"
      icon={<ReceiptIcon size={22} />}
      title={selected ? "Your receipt" : "Receipts"}
      description={selected ? undefined : "Proof that an item was released to you, with a code anyone can check."}
    >
      {!selected && (
        <div role="tablist" aria-label="Receipts" className={`${CX.cardSm} mb-4 flex gap-1 p-1.5`}>
          {([["mine", "My receipts"], ["check", "Check a receipt"]] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`flex-1 rounded-[12px] py-2.5 text-[13.5px] font-semibold transition-colors ${tab === value ? "bg-navy-800 text-white" : "text-ink-soft hover:bg-navy-50"}`}>{label}</button>
          ))}
        </div>
      )}

      {selected && (
        <div className="space-y-4">
          <button type="button" onClick={() => setSelected(null)} className={`${CX.btnSubtle} -ml-2 !min-h-[40px]`}><ArrowLeft size={16} aria-hidden="true" />All receipts</button>
          <Sheet receipt={selected} />
        </div>
      )}

      {!selected && tab === "mine" && (
        <>
          {receipts === null && <ReportGridSkeleton count={2} />}
          {error && <p role="alert" className={CX.alertError}>{error}</p>}
          {receipts && receipts.length === 0 && !error && (
            <div className="rounded-2xl border border-dashed border-line-strong bg-frost-50 px-6 py-9 text-center" role="status">
              <span className="mx-auto mb-2 flex size-11 items-center justify-center rounded-2xl bg-white text-navy-700 shadow-sm" aria-hidden="true"><ReceiptIcon size={20} /></span>
              <p className="text-[16px] font-semibold text-ink" style={{ fontFamily: "var(--font-heading)" }}>No receipts yet</p>
              <p className="mx-auto mt-1 max-w-[40ch] text-[13.5px] leading-5 text-ink-muted">When the Lost and Found Office releases an item to you, or you collect an Auction Hall win, your receipt appears here and in your email.</p>
            </div>
          )}
          {receipts && receipts.length > 0 && (
            <ul className="space-y-2.5">
              {receipts.map((receipt) => (
                <li key={receipt.receipt_no}>
                  <button type="button" onClick={() => setSelected(receipt)} className={`${CX.cardHover} flex w-full items-center gap-3 p-3.5 text-left`}>
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-700" aria-hidden="true">{receipt.kind === "auction" ? <Gavel size={19} /> : <PackageCheck size={19} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold text-navy-800">{receipt.item.name}</span>
                      <span className="block truncate font-mono text-[12.5px] text-ink-muted">{receipt.receipt_no}</span>
                      <span className="block text-[12.5px] text-ink-muted">{manilaDateTime(receipt.released_at)}</span>
                    </span>
                    <ShieldCheck size={18} className="shrink-0 text-tide-600" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!selected && tab === "check" && (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void check(); }}>
          <p className="text-[14px] leading-6 text-ink-soft">Someone shows you a receipt, or you want to confirm your own. Enter the number and code printed on it.</p>
          <label className="block"><span className={CX.label}>Receipt number</span><input value={number} onChange={(event) => setNumber(event.target.value.toUpperCase())} placeholder="HR-20261020-CL-0007" autoComplete="off" spellCheck={false} className={`${CX.input} w-full font-mono`} /></label>
          <label className="block"><span className={CX.label}>Verification code</span><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABCDE-FGHIJ" autoComplete="off" spellCheck={false} maxLength={11} className={`${CX.input} w-full font-mono tracking-[0.1em]`} /></label>
          {checkError && <p role="alert" className={CX.alertError}>{checkError}</p>}
          {result && <Check_ result={result} />}
          <button type="submit" disabled={checking || !number.trim() || !code.trim()} className={`${CX.btnNavy} w-full`}><ShieldCheck size={16} aria-hidden="true" />{checking ? "Checking..." : "Check receipt"}</button>
        </form>
      )}
    </Modal>
  );
}
