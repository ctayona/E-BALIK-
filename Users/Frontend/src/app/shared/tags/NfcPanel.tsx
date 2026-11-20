import { useEffect, useRef, useState } from "react";
import { Nfc, RefreshCw, ShieldCheck } from "lucide-react";
import { CX } from "@/app/utils/clay";
import { tagsApi } from "@/app/utils/tags";
import { nfcAvailable, nfcError, nfcSize, validateNfcPayload, verifyNfc, writeNfc, type NfcPayload } from "@/app/utils/nfc";

/** Local React runtime; only the framework-independent NFC helpers are shared. */
export default function NfcPanel({ tagId }: { tagId: string }) {
  const [payload, setPayload] = useState<NfcPayload | null>(null);
  const [offline, setOffline] = useState(false);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [verified, setVerified] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const supported = nfcAvailable();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; operation.current?.abort(); };
  }, []);
  useEffect(() => {
    generation.current++;
    operation.current?.abort();
    setPayload(null); setVerified(false); setReplace(false); setMessage(""); setBusy(false);
  }, [tagId, offline]);
  useEffect(() => {
    if (!payload) return;
    const timer = window.setTimeout(() => {
      operation.current?.abort(); setPayload(null); setVerified(false);
      setMessage("Preparation expired. Prepare the current tag details again.");
    }, 120_000);
    return () => window.clearTimeout(timer);
  }, [payload]);

  const prepare = async () => {
    const current = ++generation.current;
    setBusy(true); setPayload(null); setVerified(false); setError(false); setMessage("");
    try {
      const next = validateNfcPayload(await tagsApi.nfc(tagId, offline));
      if (mounted.current && current === generation.current) setPayload(next);
    } catch (reason) {
      if (mounted.current && current === generation.current) { setError(true); setMessage(nfcError(reason)); }
    } finally { if (mounted.current && current === generation.current) setBusy(false); }
  };
  const run = async (kind: "write" | "verify") => {
    if (!payload || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const current = generation.current;
    setBusy(true); setError(false); setVerified(false);
    setMessage(kind === "write" ? "Hold only this tag near your phone. Waiting to write…" : "Move the card away, then tap again to read and compare every record…");
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      // Called synchronously inside the click handler to preserve browser user activation.
      await (kind === "write" ? writeNfc(payload, controller.signal, replace) : verifyNfc(payload, controller.signal));
      if (mounted.current && current === generation.current) {
        setVerified(kind === "verify");
        setMessage(kind === "write" ? "Card written. Use Verify card next; writing alone is not read-back confirmation." : "Read-back matches this tag and all prepared records. Now test a normal phone tap.");
      }
    } catch (reason) {
      if (mounted.current && current === generation.current) { setError(true); setMessage(nfcError(reason)); }
    } finally {
      window.clearTimeout(timeout); controller.abort();
      if (operation.current === controller) operation.current = null;
      if (mounted.current && current === generation.current) setBusy(false);
    }
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setError(false); setMessage("Copied. Writing and read-back still need to be completed."); }
    catch { setError(true); setMessage("Clipboard unavailable. Select and copy the displayed value."); }
  };

  return (
    <details className="rounded-2xl border border-line bg-frost-50 p-4 text-ink">
      <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 font-semibold"><Nfc size={20} aria-hidden="true" />NFC card setup <span className="ml-auto text-[12px] font-normal text-ink-muted">Tap to open</span></summary>
      <div className="mt-3 space-y-4 text-[13px] leading-6">
        <p>Each NFC item has its own code. The backup QR opens this same item; it does not create a second registration.</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={offline} disabled={busy} onChange={e => setOffline(e.target.checked)} className="mt-1 size-4 shrink-0" /><span>I choose to copy my visible name and phone number onto this card for offline recovery. Anyone with a reader can see them. Approval is required. Changing privacy, disabling or expiring the tag cannot erase this copy; I must physically rewrite the card. A reader app may be needed offline.</span></label>
        <button type="button" className={`${CX.btnGhost} min-h-[44px] disabled:opacity-50`} disabled={busy} onClick={() => void prepare()}><RefreshCw size={15} aria-hidden="true" />Prepare NFC card</button>
        {!supported && <p>Direct writing needs Chrome on an NFC-enabled Android phone over HTTPS. You can use the manual steps below with NFC Tools.</p>}
        {payload && <>
          <div className="rounded-xl border border-line bg-white p-3 dark:bg-navy-900">
            <p className="font-semibold">Record 1 · URL / URI</p>
            <textarea readOnly aria-label="NFC website URL" value={payload.url} rows={2} className="mt-1 w-full resize-none break-all rounded-lg border border-line bg-transparent p-2 font-mono text-[12px] text-ink" />
            <button type="button" className={`${CX.btnGhost} min-h-[44px] disabled:opacity-50`} onClick={() => void copy(payload.url)}>Copy URL</button>
            {payload.offline_contact && <>
              <p className="mt-3 font-semibold">Record 2 · Text (English / UTF-8)</p>
              <textarea readOnly aria-label="Offline recovery contact" value={payload.records[1].data} rows={4} className="mt-1 w-full rounded-lg border border-line bg-transparent p-2 text-ink" />
              <button type="button" className={`${CX.btnGhost} min-h-[44px] disabled:opacity-50`} onClick={() => void copy(payload.records[1].data)}>Copy contact text</button>
            </>}
            <p className="mt-2 text-ink-muted">Requires approximately {nfcSize(payload)} bytes of writable NDEF storage. Check card capacity; use NTAG215/216 for extra room.</p>
          </div>
          <label className="flex items-start gap-2"><input type="checkbox" checked={replace} disabled={busy} onChange={e => { setReplace(e.target.checked); setVerified(false); }} className="mt-1 size-4 shrink-0" /><span>Replace existing card contents. I checked the physical code is {tagId}. This erases every old record, including any offline contact.</span></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${CX.btnGhost} min-h-[44px] disabled:opacity-50`} disabled={busy || !supported} onClick={() => void run("write")}><Nfc size={16} aria-hidden="true" />Write card</button>
            <button type="button" className={`${CX.btnGhost} min-h-[44px] disabled:opacity-50`} disabled={busy || !supported} onClick={() => void run("verify")}><ShieldCheck size={16} aria-hidden="true" />Verify card</button>
            {busy && <button type="button" className={`${CX.btnGhost} min-h-[44px] disabled:opacity-50`} onClick={() => operation.current?.abort()}>Cancel NFC</button>}
          </div>
          <details className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer font-semibold">Manual writing with NFC Tools</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Use a writable NDEF-compatible NFC card. Keep unsold cards safe; anyone with the link can start registration.</li>
              <li>Open Write → Add a record → URL / URI. Paste Record 1 exactly.</li>
              <li>{payload.offline_contact ? "Add a Text record second and paste Record 2. Keep the URL first." : "Write only the URL record; remove any old contact or unrelated records."}</li>
              <li>Check the card label against {tagId}, write, then read the card and compare every record with this preview.</li>
              <li>Close the writer and tap normally. A blank tag opens registration; approved tags show only the owner's selected details. Keep the card rewritable if contact details may change.</li>
            </ol>
          </details>
        </>}
        {message && <p role={error ? "alert" : "status"} className={`rounded-xl border p-3 ${error ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-400/40 dark:bg-rose-950 dark:text-rose-100" : "border-line bg-white text-ink dark:bg-navy-900"}`}>{verified && <ShieldCheck className="mr-2 inline" size={16} aria-hidden="true" />}{message}</p>}
        <p className="text-ink-muted">Setup does not register or approve an item. Physical card checks are for this session only. Card contents can be copied; NFC is a recovery link, not proof of ownership.</p>
      </div>
    </details>
  );
}
