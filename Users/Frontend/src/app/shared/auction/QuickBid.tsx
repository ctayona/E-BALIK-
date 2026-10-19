import { useEffect, useId, useState } from "react";
import { Gavel, ShieldCheck, Zap } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { CX } from "@/app/utils/clay";
import { isVerified, useCurrentUser } from "@/app/utils/system";
import { AuctionRequestError, auctionsApi, peso, pesoShort, type Auction } from "@/app/utils/auctions";

/** Bids sit on a ladder: the starting bid plus whole increments (start 100, step 100 means 100, 200, 300, never 150). Same rule as the lot window and the server. */
export function bidCheck(a: Pick<Auction, "starting_price" | "bid_increment" | "min_next_bid" | "buyout_price">, value: number) {
  const cents = (n: number) => Math.round(n * 100);
  const onStep = a.bid_increment > 0 && cents(value) >= cents(a.starting_price) && (cents(value) - cents(a.starting_price)) % cents(a.bid_increment) === 0;
  const reachesBuyNow = a.buyout_price != null && value >= a.buyout_price;
  const valid = Number.isFinite(value) && value >= a.min_next_bid && value <= 10_000_000 && (onStep || reachesBuyNow);
  const nextStep = a.bid_increment > 0 && Number.isFinite(value) && value > 0
    ? Math.max(a.min_next_bid, a.starting_price + Math.ceil(Math.max(0, cents(value) - cents(a.starting_price)) / cents(a.bid_increment)) * a.bid_increment)
    : a.min_next_bid;
  return { onStep, valid, nextStep, reachesBuyNow };
}

/**
 * The bid box on an auction card: a peso field and a gold Place Bid button. Nothing is sent before the confirmation window, exactly like the
 * lot window: bids are binding. Buy Now stays in the lot window (`onOpen`), where its own confirmation explains that it ends the auction.
 * Accounts that are not verified get a button to verify instead of the box (the server refuses their bids anyway).
 */
export default function QuickBid({ auction: a, onPlaced, onOpen, onVerify, tone = "night" }: {
  auction: Auction;
  onPlaced: () => void;
  onOpen: () => void;
  onVerify?: () => void;
  tone?: "night" | "light";
}) {
  const id = useId();
  const verified = isVerified(useCurrentUser());
  const [amount, setAmount] = useState(String(a.min_next_bid));
  const [problem, setProblem] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const night = tone === "night";

  // If someone else raises the price, lift the field to the new minimum.
  useEffect(() => { setAmount((current) => (Number(current) < a.min_next_bid ? String(a.min_next_bid) : current)); }, [a.min_next_bid]);

  const value = Number(amount);
  const check = bidCheck(a, value);
  const leading = a.my_state === "leading";

  const request = (event: React.FormEvent) => {
    event.preventDefault();
    if (check.reachesBuyNow && a.buyout_price != null && !a.bought_out) {
      setProblem(`That reaches the Buy Now price (${peso(a.buyout_price)}). Open the lot to buy it now.`);
      return;
    }
    if (!check.valid) {
      setProblem(value >= a.min_next_bid && !check.onStep ? `Bids go up in exact steps of ${peso(a.bid_increment)}. The nearest bid you can place is ${peso(check.nextStep)}.` : `Your bid must be at least ${peso(a.min_next_bid)}.`);
      return;
    }
    setProblem("");
    setConfirmOpen(true);
  };

  const place = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await auctionsApi.bid(a.id, Math.round(value * 100) / 100);
      setConfirmOpen(false);
      showInfoModal({
        variant: "success",
        title: "Bid placed",
        message: result.message,
        details: [`Your bid: ${peso(value)}`, result.extended ? "The closing time was extended because your bid came in at the last moment." : "You will be notified if someone outbids you."],
      });
      onPlaced();
    } catch (reason) {
      setConfirmOpen(false);
      if (reason instanceof AuctionRequestError) {
        if (reason.suggested) setAmount(String(reason.suggested));
        else if (reason.minBid) setAmount(String(reason.minBid));
        showInfoModal(reason.verificationRequired
          ? { variant: "warning", title: "Verify your account first", message: reason.message, details: ["Open My Profile and upload a school or government ID."] }
          : { variant: "error", title: reason.suggested ? "Bid is between two steps" : reason.minBid ? "Someone bid first" : "Bid not placed", message: reason.message, details: reason.suggested ? [`Next valid bid: ${peso(reason.suggested)}.`] : reason.minBid ? [`The new minimum bid is ${peso(reason.minBid)}.`] : undefined });
        onPlaced();
      } else {
        showInfoModal({ variant: "error", title: "Bid not placed", message: "The bid could not be placed. Try again." });
      }
    } finally {
      setBusy(false);
    }
  };

  if (!verified) {
    return (
      <div className={`rounded-2xl p-3.5 text-[13.5px] leading-5 ${night ? "bg-white/[0.06] text-white/75 ring-1 ring-white/10" : "bg-frost-100 text-ink-soft"}`}>
        <p className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-gold-300" aria-hidden="true" />Bidding needs a verified account. Upload a school or government ID once and you can bid on any lot.</p>
        {onVerify && <button type="button" onClick={onVerify} className={`${CX.btnGold} mt-3 min-h-[44px] w-full`}>Verify my account</button>}
      </div>
    );
  }

  if (leading) {
    return (
      <p className={`flex items-center gap-2 rounded-2xl px-3.5 py-3 text-[14px] font-semibold ${night ? "bg-tide-500/15 text-tide-100 ring-1 ring-tide-300/30" : "bg-tide-50 text-tide-700 ring-1 ring-tide-200"}`}>
        <ShieldCheck size={17} aria-hidden="true" />You have the highest bid. We tell you if someone outbids you.
      </p>
    );
  }

  return (
    <>
      <form onSubmit={request} noValidate>
        <label htmlFor={`${id}-amount`} className={`mb-1.5 block text-[12.5px] font-medium ${night ? "text-white/60" : "text-ink-muted"}`}>Your bid</label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <span className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px] font-semibold ${night ? "text-gold-300" : "text-navy-700"}`} aria-hidden="true">₱</span>
            <input
              id={`${id}-amount`}
              value={amount}
              onChange={(event) => { setAmount(event.target.value.replace(/[^0-9.]/g, "")); setProblem(""); }}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={Boolean(problem)}
              aria-describedby={`${id}-help`}
              className={`h-12 w-full rounded-xl pl-8 pr-3 text-[17px] font-semibold tabular-nums outline-none transition-[border-color,box-shadow,background-color] ${
                night
                  ? "border border-white/15 bg-white/[0.07] text-white placeholder:text-white/40 focus:border-gold-400 focus:bg-white/[0.1] focus:shadow-[0_0_0_4px_rgba(209,161,83,0.25)]"
                  : `${CX.input} !h-12 !pl-8`
              } ${problem ? "!border-rose-400" : ""}`}
            />
          </div>
          <button type="submit" className={`${CX.btnGold} h-12 shrink-0 px-5 shadow-[0_10px_24px_-12px_rgba(209,161,83,0.95)]`}><Gavel size={17} aria-hidden="true" />Place Bid</button>
        </div>
        <p id={`${id}-help`} role={problem ? "alert" : undefined} className={`mt-1.5 text-[12.5px] leading-5 ${problem ? (night ? "text-rose-300" : "text-rose-700") : night ? "text-white/55" : "text-ink-muted"}`}>
          {problem || `Minimum ${peso(a.min_next_bid)} · steps of ${peso(a.bid_increment)}`}
        </p>
        {a.buyout_price != null && !a.bought_out && (
          <button type="button" onClick={onOpen} className={`mt-1 inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-semibold ${night ? "text-gold-300 hover:text-gold-200" : "text-gold-800"}`}>
            <Zap size={14} fill="currentColor" aria-hidden="true" />Buy Now for {peso(a.buyout_price)}
          </button>
        )}
      </form>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        dismissible={!busy}
        size="sm"
        tone="gold"
        icon={<Gavel size={21} />}
        eyebrow="Confirm your bid"
        title={`Bid ${peso(value)} on this item?`}
        description="Bids are binding. You cannot take a bid back."
        footer={<>
          <button type="button" onClick={() => setConfirmOpen(false)} disabled={busy} className={CX.btnGhost}>Cancel</button>
          <button type="button" onClick={() => void place()} disabled={busy} data-autofocus className={CX.btnGold}>{busy ? "Placing…" : `Confirm ${pesoShort(value)}`}</button>
        </>}
      >
        <div className="rounded-2xl border border-gold-200 bg-gold-50 px-4 py-3.5">
          <p className="text-[13px] font-medium text-ink-muted">{a.title}</p>
          <p className="mt-0.5 font-[family-name:var(--font-heading)] text-[28px] font-semibold tabular-nums text-navy-800">{peso(value)}</p>
          <p className="text-[13px] text-ink-muted">{a.bid_count === 0 ? "Opening bid" : `Current bid ${peso(a.current_price)}`}</p>
        </div>
        <ul className="mt-4 space-y-1.5 text-[14px] leading-6 text-ink-soft">
          <li>If you win, you pay and collect the item at the Lost and Found Office.</li>
          <li>Winners who do not collect can be suspended from E-Balik.</li>
          <li>An administrator confirms the result after bidding closes.</li>
        </ul>
      </Modal>
    </>
  );
}
