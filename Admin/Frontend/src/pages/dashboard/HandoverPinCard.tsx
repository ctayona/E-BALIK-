import { useRef, useState } from "react";
import { CheckCircle2, KeyRound, PackageCheck, ShieldCheck, UserRound, X } from "lucide-react";
import { peso } from "../../utils/auctionApi";
import { lookupHandoverPin, releaseByHandoverPin, type HandoverClaim } from "../../utils/api";
import ScanPinButton from "./ScanPinButton";
import { BTN } from "../../components/ui/primitives";
import { tr } from "../../utils/preferences";

type Step = "enter" | "confirm" | "done";

/** Shows the PIN as the guard types it: upper case, no look-alike characters, grouped in 3 and 3. */
function formatPin(raw: string) {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return clean.length > 3 ? `${clean.slice(0, 3)} ${clean.slice(3)}` : clean;
}

/**
 * The guard's screen for the physical handover. The claimant reads out the PIN from their approval email; the guard
 * types it, checks the name and ID shown here against the person in front of them, then releases the item.
 */
export default function HandoverPinCard() {
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<Step>("enter");
  const [claim, setClaim] = useState<HandoverClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [released, setReleased] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const complete = pin.replace(/\s/g, "").length === 6;
  const isAuction = claim?.kind === "auction";

  const reset = () => {
    setPin(""); setStep("enter"); setClaim(null); setError(""); setReleased("");
    window.setTimeout(() => inputRef.current?.focus(), 30);
  };

  const check = async (value: string = pin) => {
    if (value.replace(/\s/g, "").length !== 6 || busy) return;
    setBusy(true); setError("");
    try {
      setClaim(await lookupHandoverPin(value));
      setStep("confirm");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to check that PIN."));
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    if (!claim || busy) return;
    setBusy(true); setError("");
    try {
      const message = await releaseByHandoverPin(pin);
      setReleased(message);
      setStep("done");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to release the item."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-card relative overflow-hidden p-5 sm:p-6" aria-labelledby="handover-heading">
      <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-gold-500/10 blur-3xl" aria-hidden="true" />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div>
          <span className="flex size-11 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><KeyRound size={21} /></span>
          <h2 id="handover-heading" className="mt-3 font-[family-name:var(--font-heading)] text-[20px] font-semibold text-ink">{tr("Release an item with a Handover PIN")}</h2>
          <p className="mt-1 max-w-[46ch] text-[14px] leading-6 text-ink-muted">{tr("Ask the owner (or the auction winner) for the 6 character PIN from their email or account, check their ID, then release the item. A claim PIN closes the claim; an auction PIN completes the auction after the winner has paid.")}</p>
        </div>

        <div className="min-w-0">
          {step === "enter" && (
            <form onSubmit={(event) => { event.preventDefault(); void check(); }} className="space-y-3">
              <label htmlFor="handover-pin" className="block text-[14px] font-semibold text-ink-soft">{tr("Handover PIN")}</label>
              <input
                id="handover-pin"
                ref={inputRef}
                value={pin}
                onChange={(event) => { setPin(formatPin(event.target.value)); setError(""); }}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="K7M 2QX"
                aria-describedby={error ? "handover-error" : undefined}
                className="min-h-[64px] w-full rounded-2xl border border-line-strong bg-[var(--surface)] px-5 text-center font-mono text-[32px] font-bold uppercase tracking-[0.3em] text-ink outline-none transition focus:border-gold-500 focus:ring-4 focus:ring-gold-500/20 placeholder:text-ink-muted/40"
              />
              {error && <p id="handover-error" role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[14px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-[#fecdd3]">{error}</p>}
              <button type="submit" disabled={!complete || busy} className={`${BTN.gold} min-h-[48px] w-full text-[15px]`}><ShieldCheck size={18} aria-hidden="true" />{busy ? tr("Checking…") : tr("Check PIN")}</button>
              <ScanPinButton disabled={busy} onPin={(scanned) => { const shown = formatPin(scanned); setPin(shown); void check(shown); }} />
            </form>
          )}

          {step === "confirm" && claim && (
            <div className="space-y-4" aria-live="polite">
              <div className="rounded-2xl border border-gold-300/70 bg-gold-50 p-4 dark:border-gold-500/30 dark:bg-gold-500/10">
                <p className="text-[12.5px] font-semibold text-ink-muted">{isAuction ? tr("Auction winner") : tr("Release to")}</p>
                <p className="mt-0.5 flex items-center gap-2 break-words font-[family-name:var(--font-heading)] text-[24px] font-semibold leading-tight text-ink"><UserRound size={20} className="shrink-0 text-gold-600" aria-hidden="true" />{claim.claimant_name}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-[14px]">
                  <div><dt className="text-[12px] text-ink-muted">{tr("Campus ID (check their ID card)")}</dt><dd className="font-mono font-semibold text-ink">{claim.claimant_campus_id || "—"}</dd></div>
                  <div><dt className="text-[12px] text-ink-muted">{isAuction ? tr("Auction item") : tr("Claim reference")}</dt><dd className="font-mono font-semibold text-ink">{claim.claim_reference}</dd></div>
                  {isAuction && claim.amount_due != null && (
                    <div className="col-span-2 rounded-xl bg-white/60 px-3 py-2 dark:bg-white/[0.06]"><dt className="text-[12px] text-ink-muted">{tr("Collect payment before handing over")}</dt><dd className="font-[family-name:var(--font-heading)] text-[22px] font-semibold tabular-nums text-ink">{peso(claim.amount_due)}</dd></div>
                  )}
                  <div className="col-span-2"><dt className="text-[12px] text-ink-muted">{tr("Item")}</dt><dd className="font-semibold text-ink">{claim.item_name}{claim.found_item_reference ? <span className="ml-2 font-mono text-[12.5px] font-normal text-ink-muted">{claim.found_item_reference}</span> : null}</dd></div>
                </dl>
              </div>
              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[14px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-[#fecdd3]">{error}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={reset} disabled={busy} className={BTN.ghost}><X size={16} aria-hidden="true" />{tr("Not this person")}</button>
                <button type="button" onClick={() => void release()} disabled={busy} className={`${BTN.success} min-h-[48px] px-6`}><PackageCheck size={18} aria-hidden="true" />{busy ? tr("Releasing…") : isAuction ? tr("Payment received: complete the auction") : tr("Release item to owner")}</button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-4 text-center" role="status">
              <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#23977c]/15 text-[#23977c]" aria-hidden="true"><CheckCircle2 size={30} /></span>
              <div>
                <p className="font-[family-name:var(--font-heading)] text-[20px] font-semibold text-ink">{isAuction ? tr("Auction completed") : tr("Item released")}</p>
                <p className="mt-1 text-[14px] leading-6 text-ink-muted">{released}</p>
              </div>
              <button type="button" onClick={reset} className={BTN.ghost}>{tr("Release another item")}</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
