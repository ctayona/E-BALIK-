import { useState } from "react";
import { Repeat2, UserX } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT } from "../../components/ui/primitives";
import { reauctionAdminAuction, peso, type AdminAuction } from "../../utils/auctionApi";
import { tr } from "../../utils/preferences";

const DURATIONS = [
  { minutes: 1440, label: "1 day" },
  { minutes: 4320, label: "3 days" },
  { minutes: 10080, label: "7 days" },
];
const SUSPENSIONS = [3, 7, 14, 30];

/** List a forfeited or unfinished sale again, optionally suspending the bidder who did not complete it. */
export default function ReauctionModal({ auction, onClose, onDone }: { auction: AdminAuction; onClose: () => void; onDone: () => void }) {
  const person = auction.winner_detail ?? auction.leader_detail;
  const [price, setPrice] = useState(String(auction.starting_price));
  const [increment, setIncrement] = useState(String(auction.bid_increment));
  const [minutes, setMinutes] = useState(4320);
  const [reason, setReason] = useState("");
  const [suspend, setSuspend] = useState(false);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await reauctionAdminAuction(auction.id, {
        starting_price: price,
        bid_increment: increment,
        duration_minutes: minutes,
        reason: reason.trim(),
        suspend_days: suspend && person ? days : null,
      });
      onDone();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to re-auction this item."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminModal
      title={tr("Re-auction {0}?", { "0": auction.title })}
      description={tr("The current sale is cancelled and the item goes up for bidding again as a new auction.")}
      icon={<Repeat2 size={19} />}
      tone="gold"
      size="md"
      busy={busy}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Back")}</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !price} className={suspend ? BTN.danger : BTN.primary}>
          {busy ? tr("Working…") : suspend ? tr("Re-auction and suspend") : tr("Re-auction item")}
        </button>
      </>}
    >
      {person && (
        <div className="mb-4 rounded-2xl border border-gold-300/60 bg-gold-50 px-4 py-3 text-[14px] leading-6 text-ink-soft dark:bg-gold-500/10">
          {tr("Last result: {0} with a bid of {1}.", { "0": person.name, "1": peso(auction.winning_amount ?? auction.current_price) })}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Starting bid (₱)")}</span>
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className={INPUT} data-autofocus />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Bid increment (₱)")}</span>
          <input value={increment} onChange={(event) => setIncrement(event.target.value)} inputMode="decimal" className={INPUT} />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-[14px] font-semibold text-ink-soft">{tr("Bidding stays open for")}</legend>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((option) => (
            <button key={option.minutes} type="button" aria-pressed={minutes === option.minutes} onClick={() => setMinutes(option.minutes)} className={`min-h-[40px] rounded-xl border px-3.5 text-[13.5px] font-semibold transition ${minutes === option.minutes ? "border-gold-500 bg-gold-50 text-navy-900 dark:bg-gold-500/15 dark:text-gold-200" : "border-line-strong bg-[var(--surface)] text-ink-soft hover:border-iris-300"}`}>{tr(option.label)}</button>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Reason (kept in the record)")}</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={300} placeholder={tr("The winner did not reply or collect the item.")} className={`${INPUT} resize-y py-3 leading-6`} />
      </label>

      {person && (
        <div className={`mt-5 rounded-2xl border p-4 transition ${suspend ? "border-rose-300 bg-rose-50/70 dark:bg-rose-500/10" : "border-line bg-frost-50"}`}>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={suspend} onChange={(event) => setSuspend(event.target.checked)} className="mt-1 size-4 accent-rose-600" />
            <span>
              <span className="flex items-center gap-2 text-[14.5px] font-semibold text-ink"><UserX size={16} className="text-rose-600" aria-hidden="true" />{tr("Suspend {0} because they did not complete the sale", { "0": person.name })}</span>
              <span className="mt-0.5 block text-[13px] leading-5 text-ink-muted">{tr("They are signed out and told why. This does not apply to admin accounts.")}</span>
            </span>
          </label>
          {suspend && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={tr("Suspension length")}>
              {SUSPENSIONS.map((value) => (
                <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)} className={`min-h-[38px] rounded-xl border px-3.5 text-[13.5px] font-semibold ${days === value ? "border-rose-400 bg-white text-rose-800 dark:bg-rose-500/20 dark:text-rose-100" : "border-line-strong bg-[var(--surface)] text-ink-soft hover:border-rose-300"}`}>{tr("{0} days", { "0": value })}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{error}</p>}
    </AdminModal>
  );
}
