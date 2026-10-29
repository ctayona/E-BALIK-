import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, MessageSquareWarning, PackageCheck, ShieldCheck, Store, Undo2, UserRound, Wallet, XCircle } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT } from "../../components/ui/primitives";
import { SegmentedFilter, StatusPill, type Tone } from "../../components/ui/management";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { formatDateTime } from "../../utils/countdown";
import { peso } from "../../utils/incomeApi";
import { tr } from "../../utils/preferences";
import { SellerSetupError, fetchSellerListings, returnSellerListing, reviewSellerListing, type ListingStatus, type SellerListingAdmin, type SellerListingList } from "../../utils/sellerApi";

type View = "review" | "changes_requested" | "listed" | "closed";
const CLOSED: ListingStatus[] = ["rejected", "withdrawn", "returned"];
const TONE: Record<ListingStatus, Tone> = { pending: "gold", changes_requested: "iris", listed: "mint", rejected: "rose", withdrawn: "slate", returned: "slate" };
const CONDITION: Record<string, string> = { new: "New", like_new: "Like new", used: "Used", worn: "Well used" };

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[12.5px] font-medium text-ink-muted">{label}</dt><dd className="mt-0.5 break-words text-[14px] font-semibold text-ink">{value}</dd></div>;
}

/** Check a listing against the item the seller brought in, then approve it (it goes on the Auction Hall), ask for changes, or reject it. */
function ReviewModal({ listing, onClose, onDone }: { listing: SellerListingAdmin; onClose: () => void; onDone: () => void }) {
  const [photo, setPhoto] = useState(0);
  const [received, setReceived] = useState(false);
  const [note, setNote] = useState("");
  const [increment, setIncrement] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [busy, setBusy] = useState<"" | "approve" | "request_changes" | "reject">("");
  const decide = async (action: "approve" | "request_changes" | "reject") => {
    setBusy(action);
    try {
      await reviewSellerListing(listing.id, { action, note: note.trim(), item_received: received, bid_increment: increment || undefined, starts_at: startsAt ? new Date(startsAt).toISOString() : undefined });
      onDone();
    } catch { /* the reason was already shown */ } finally { setBusy(""); }
  };
  const noteOk = note.trim().length >= 8;
  return (
    <AdminModal title={tr("Review listing")} description={tr("Approve only when the item is at the office and matches the photos and the description.")} icon={<Store size={19} />} tone="gold" size="xl" busy={Boolean(busy)} onClose={onClose}
      footer={<>
        <button type="button" onClick={() => void decide("reject")} disabled={!noteOk || Boolean(busy)} className={BTN.ghost}><XCircle size={16} aria-hidden="true" />{busy === "reject" ? tr("Rejecting…") : tr("Reject")}</button>
        <button type="button" onClick={() => void decide("request_changes")} disabled={!noteOk || Boolean(busy)} className={BTN.ghost}><MessageSquareWarning size={16} aria-hidden="true" />{busy === "request_changes" ? tr("Sending…") : tr("Ask for changes")}</button>
        <button type="button" onClick={() => void decide("approve")} disabled={!received || Boolean(busy)} className={BTN.primary}><CheckCircle2 size={16} aria-hidden="true" />{busy === "approve" ? tr("Listing…") : tr("Approve and list")}</button>
      </>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div>
          <div className="overflow-hidden rounded-2xl border border-line bg-frost-50 dark:bg-white/[0.04]">
            {listing.photos[photo] ? <img src={listing.photos[photo]} alt={listing.title} className="aspect-square w-full object-contain" /> : <div className="aspect-square" />}
          </div>
          {listing.photos.length > 1 && (
            <div className="mt-2 flex gap-2">
              {listing.photos.map((url, index) => (
                <button key={url} type="button" onClick={() => setPhoto(index)} aria-label={tr("Photo {0}", { "0": index + 1 })} aria-pressed={photo === index} className={`size-16 overflow-hidden rounded-xl ring-2 ${photo === index ? "ring-gold-500" : "ring-transparent"}`}><img src={url} alt="" className="size-full object-cover" /></button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-[13px] text-ink-muted">{[listing.category, tr(CONDITION[listing.condition] ?? listing.condition)].filter(Boolean).join(" · ")}</p>
            <h3 className="font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight text-ink">{listing.title}</h3>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-6 text-ink-soft">{listing.description}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-line p-4 sm:grid-cols-3">
            <Fact label={tr("Starting bid")} value={peso(listing.starting_price)} />
            <Fact label={tr("Buy-now")} value={listing.buyout_price ? peso(listing.buyout_price) : tr("None")} />
            <Fact label={tr("Length")} value={tr("{0} day(s)", { "0": listing.duration_days })} />
            <Fact label={tr("Fee they accepted")} value={`${listing.fee.rate}% · ${peso(listing.fee.minimum)}–${listing.fee.cap ? peso(listing.fee.cap) : "∞"}`} />
            <Fact label={tr("Seller")} value={`${listing.seller.name || "—"}${listing.seller.campus_id ? ` (${listing.seller.campus_id})` : ""}`} />
            <Fact label={tr("Paid by")} value={`${tr(listing.payout_method_label)}${listing.payout_account_number ? ` ${listing.payout_account_number}` : ""}`} />
          </dl>
          {listing.review_note && <p className="rounded-xl bg-frost-100 px-3 py-2 text-[13px] text-ink-soft dark:bg-white/[0.06]"><span className="font-semibold">{tr("Earlier note:")} </span>{listing.review_note}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1.5 block text-[13.5px] font-semibold text-ink-soft">{tr("Bid step (optional)")}</span><input inputMode="decimal" value={increment} onChange={(event) => setIncrement(event.target.value.replace(/[^\d.]/g, ""))} className={INPUT} placeholder={tr("Automatic")} /></label>
            <label className="block"><span className="mb-1.5 block text-[13.5px] font-semibold text-ink-soft">{tr("Start (optional)")}</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={INPUT} /></label>
          </div>
          <label className="block"><span className="mb-1.5 block text-[13.5px] font-semibold text-ink-soft">{tr("Note to the seller")}</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} className={`${INPUT} py-2.5`} placeholder={tr("Needed to ask for changes or reject (at least 8 characters).")} />
          </label>
          <label className="flex cursor-pointer gap-3 rounded-xl border-2 border-gold-300 bg-gold-50 p-3 text-[13.5px] font-medium text-gold-900 dark:bg-gold-500/10 dark:text-gold-100">
            <input type="checkbox" checked={received} onChange={(event) => setReceived(event.target.checked)} className="mt-0.5 size-4 accent-[#1f3160]" />
            <span>{tr("The item is at the office, it matches the photos, and it is not a prohibited item. The office keeps it until the buyer collects it.")}</span>
          </label>
        </div>
      </div>
    </AdminModal>
  );
}

function ReturnModal({ listing, onClose, onDone }: { listing: SellerListingAdmin; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await returnSellerListing(listing.id, note.trim()); onDone(); } catch { /* shown already */ } finally { setBusy(false); }
  };
  return (
    <AdminModal title={tr("Give the item back")} description={tr("Use this when the seller collects an item that did not sell or whose auction was cancelled.")} icon={<Undo2 size={19} />} size="sm" busy={busy} onClose={onClose}
      footer={<><button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button><button type="button" onClick={() => void submit()} disabled={busy} className={BTN.primary}><PackageCheck size={16} aria-hidden="true" />{busy ? tr("Saving…") : tr("Item given back")}</button></>}>
      <p className="text-[14px] text-ink-soft">{tr("{0} goes back to {1}. Check their ID.", { "0": listing.title, "1": listing.seller.name || tr("the seller") })}</p>
      <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className={`${INPUT} mt-3`} placeholder={tr("Note (optional)")} />
    </AdminModal>
  );
}

export default function SellerListings({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<SellerListingList | null>(null);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState("");
  const [view, setView] = useState<View>("review");
  const [reviewing, setReviewing] = useState<SellerListingAdmin | null>(null);
  const [returning, setReturning] = useState<SellerListingAdmin | null>(null);

  const load = useCallback(() => {
    fetchSellerListings().then((value) => { setData(value); setError(""); }).catch((failure) => {
      if (failure instanceof SellerSetupError) setSetup(failure.message);
      else setError(failure instanceof Error ? failure.message : tr("Unable to load the seller listings."));
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  const done = () => { setReviewing(null); setReturning(null); load(); onChanged?.(); };

  const rows = useMemo(() => (data?.listings ?? []).filter((row) => view === "review" ? row.status === "pending" : view === "closed" ? CLOSED.includes(row.status) : row.status === view), [data, view]);
  if (setup) return <p role="status" className="rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-[14px] text-gold-900">{setup}</p>;
  const counts = data?.counts;

  return (
    <div className="space-y-4">
      <p className="max-w-[80ch] text-[13.5px] leading-6 text-ink-muted">{tr("People list their own items here. Check each one when the seller brings it in. Approved items go on the Auction Hall marked as a member's item; the buyer pays the office, and the seller is paid under Revenue and payments, Seller payouts, after pickup.")}</p>
      <SegmentedFilter label="Seller listings" value={view} onChange={setView} options={[
        { value: "review", label: "To review", count: counts?.pending },
        { value: "changes_requested", label: "Waiting for the seller", count: counts?.changes_requested },
        { value: "listed", label: "Listed", count: counts?.listed },
        { value: "closed", label: "Closed", count: counts ? counts.rejected + counts.withdrawn + counts.returned : undefined },
      ]} />
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>}
      {!data && !error ? <SkeletonBlock className="h-48 w-full rounded-2xl" /> : rows.length === 0 ? (
        <p className="glass-panel px-5 py-10 text-center text-[14px] text-ink-muted">{view === "review" ? tr("No listings are waiting for review.") : tr("Nothing here yet.")}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => (
            <article key={row.id} className="glass-panel flex gap-4 p-4">
              {row.photos[0] ? <img src={row.photos[0]} alt="" className="size-24 shrink-0 rounded-xl object-cover ring-1 ring-line" /> : <span className="size-24 shrink-0 rounded-xl bg-frost-100" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate font-semibold text-ink">{row.title}</h3>
                  <StatusPill tone={TONE[row.status]}>{tr(row.auction ? row.phase.replaceAll("_", " ") : row.status_label)}</StatusPill>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-muted">
                  <span className="inline-flex items-center gap-1"><UserRound size={12} aria-hidden="true" />{row.seller.name || "—"}{row.seller.campus_id ? ` · ${row.seller.campus_id}` : ""}</span>
                  {row.seller.verification_status === "verified" && <span className="inline-flex items-center gap-1 text-tide-700"><ShieldCheck size={12} aria-hidden="true" />{tr("ID verified")}</span>}
                </p>
                <p className="mt-2 text-[13px] text-ink-soft">{tr("From {0} · fee {1}% · {2}", { "0": peso(row.starting_price), "1": row.fee.rate, "2": formatDateTime(row.created_at) })}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted"><Wallet size={12} aria-hidden="true" />{tr(row.payout_method_label)}{row.payout_account_number ? ` ${row.payout_account_number}` : ""}</p>
                {row.auction && <p className="mt-1 text-[12.5px] text-ink-muted">{tr("Auction: {0}, {1} bid(s), {2}", { "0": row.auction.stage.replaceAll("_", " "), "1": row.auction.bid_count, "2": peso(row.auction.winning_amount ?? row.auction.current_price) })}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.can_approve && <button type="button" onClick={() => setReviewing(row)} className={`${BTN.gold} !min-h-[36px]`}><Store size={15} aria-hidden="true" />{row.status === "pending" ? tr("Review") : tr("Review anyway")}</button>}
                  {row.can_return && <button type="button" onClick={() => setReturning(row)} className={`${BTN.ghost} !min-h-[36px]`}><Undo2 size={15} aria-hidden="true" />{tr("Give back to seller")}</button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {reviewing && <ReviewModal listing={reviewing} onClose={() => setReviewing(null)} onDone={done} />}
      {returning && <ReturnModal listing={returning} onClose={() => setReturning(null)} onDone={done} />}
    </div>
  );
}
