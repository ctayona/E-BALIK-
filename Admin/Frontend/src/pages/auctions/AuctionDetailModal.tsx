import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Ban, CheckCheck, EyeOff, Eye, Gavel, Heart, Hourglass, Mail, PackageCheck, Pencil, Repeat2, Timer, Trash2, Trophy, Undo2, UserX } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import SuspendUserModal from "../../components/SuspendUserModal";
import ReauctionModal from "./ReauctionModal";
import { BTN, INPUT } from "../../components/ui/primitives";
import { DetailGrid, SegmentedFilter, StatusPill, type Tone } from "../../components/ui/management";
import {
  cancelAdminAuction, deleteAdminAuction, endAdminAuction, extendAdminAuctionPickup, fetchAdminAuctionDetail, finalizeAdminAuction, moderateAuctionComment, peso, resendAdminWinnerEmail, setAdminAuctionFulfillment,
  type AdminAuction, type AuctionDetail, type AuctionStage,
} from "../../utils/auctionApi";
import { setArchived } from "../../utils/archive";
import { formatDateTime, formatRemaining, serverOffset, useNow } from "../../utils/countdown";
import { tr } from "../../utils/preferences";

/** Colour of each stage. A won auction is "Awaiting pickup" until the winner has paid and collected, and only then "Completed". */
export const STAGE_TONE: Record<AuctionStage, Tone> = {
  live: "gold", scheduled: "iris", awaiting_admin: "iris", awaiting_pickup: "gold", completed: "mint", forfeited: "rose", no_bids: "slate", cancelled: "rose",
};
const STAGE_LABEL: Record<AuctionStage, string> = {
  live: "Live", scheduled: "Scheduled", awaiting_admin: "Awaiting admin", awaiting_pickup: "Awaiting pickup", completed: "Completed", forfeited: "Forfeited", no_bids: "Ended, no bids", cancelled: "Cancelled",
};
export const FINISHED_STAGES: AuctionStage[] = ["completed", "forfeited", "no_bids", "cancelled"];

export function statusLabel(auction: AdminAuction) {
  return STAGE_LABEL[auction.stage] ?? auction.status;
}

type Tab = "bids" | "comments" | "hearts" | "pickup";
type Pending = "end" | "delete" | "collected" | "forfeited" | "finalize" | "archive" | "unarchive" | "extend" | null;

export default function AuctionDetailModal({ id, canDelete, onClose, onEdit, onChanged }: {
  id: string;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (auction: AdminAuction) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AuctionDetail | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("bids");
  const [photo, setPhoto] = useState(0);
  const [pending, setPending] = useState<Pending>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reauctionOpen, setReauctionOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const now = useNow() + offset;

  const load = useCallback(async () => {
    try {
      const data = await fetchAdminAuctionDetail(id);
      setDetail(data);
      setOffset(serverOffset(data.server_time));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("Unable to load the auction."));
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const auction = detail?.auction;
  const live = auction?.status === "live" || auction?.status === "scheduled";
  const awaiting = auction?.status === "awaiting";
  const pickupPending = auction?.fulfillment_status === "awaiting_pickup";
  // Still editable (title, description, photos) while the winner has not paid and collected; finished lots are closed.
  const soldOpen = awaiting || pickupPending;
  const finished = Boolean(auction && FINISHED_STAGES.includes(auction.stage));

  const run = async (action: () => Promise<unknown>, closeAfter = false) => {
    setBusy(true);
    try {
      await action();
      onChanged();
      if (closeAfter) onClose(); else await load();
    } catch {
      // The API helper already reported the failure in the global result modal.
    } finally {
      setBusy(false);
      setPending(null);
      setCancelOpen(false);
    }
  };

  if (!auction) {
    return (
      <AdminModal title={tr("Auction")} onClose={onClose} size="xl" icon={<Gavel size={20} />}>
        <p className="py-10 text-center text-[14px] text-ink-muted" role={error ? "alert" : undefined}>{error || tr("Loading auction…")}</p>
      </AdminModal>
    );
  }

  const remaining = new Date(auction.ends_at).getTime() - now;
  const opensIn = new Date(auction.starts_at).getTime() - now;
  const bidder = auction.winner_detail ?? auction.leader_detail;
  const timeText = auction.status === "awaiting" ? tr("Closed {0}", { "0": formatDateTime(auction.ends_at) }) : auction.status === "live" ? (formatRemaining(remaining) || tr("Closing")) : auction.status === "scheduled" ? tr("Opens in {0}", { "0": formatRemaining(opensIn) || "—" }) : formatDateTime(auction.ends_at);
  const gallery = auction.gallery.length ? auction.gallery : auction.image_url ? [auction.image_url] : [];
  const tabs = [
    { value: "bids" as Tab, label: "Bids", count: detail.bids.length },
    { value: "comments" as Tab, label: "Comments", count: detail.comments.length },
    { value: "hearts" as Tab, label: "Hearts", count: detail.reactors?.length ?? auction.reaction_count ?? 0 },
    ...(auction.sold || awaiting ? [{ value: "pickup" as Tab, label: awaiting ? "Result" : "Pickup" }] : []),
  ];
  const emailFailed = Boolean(auction.winner_email_mode?.endsWith("_failed"));
  const email = auction.winner_notified_at
    ? (emailFailed ? tr("The winner email could not be sent. Check the email settings, then resend it.")
      : auction.winner_email_mode === "mock" ? tr("Mock email logged {0}. No real email was sent.", { "0": formatDateTime(auction.winner_notified_at) })
        : tr("Winner emailed {0}.", { "0": formatDateTime(auction.winner_notified_at) }))
    : tr("The winner has not been notified yet.");

  return (
    <>
      <AdminModal
        title={auction.title}
        description={tr("Lot {0}", { "0": auction.reference || "—" })}
        icon={<Gavel size={20} />}
        size="xl"
        onClose={onClose}
        footer={<>
          {canDelete && !live && !awaiting && !pickupPending && <button type="button" onClick={() => setPending("delete")} className={`${BTN.ghost} sm:mr-auto`}><Trash2 size={16} aria-hidden="true" />{tr("Delete")}</button>}
          {finished && !auction.archived && <button type="button" onClick={() => setPending("archive")} className={BTN.ghost}><Archive size={16} aria-hidden="true" />{tr("Archive")}</button>}
          {auction.archived && <button type="button" onClick={() => setPending("unarchive")} className={BTN.ghost}><ArchiveRestore size={16} aria-hidden="true" />{tr("Restore from archive")}</button>}
          {(live || awaiting) && <button type="button" onClick={() => setCancelOpen(true)} className={`${BTN.ghost} sm:mr-auto`}><Ban size={16} aria-hidden="true" />{tr("Cancel auction")}</button>}
          {awaiting && <button type="button" onClick={() => setPending("finalize")} className={BTN.success}><CheckCheck size={16} aria-hidden="true" />{tr("Confirm winner")}</button>}
          {auction.status === "live" && <button type="button" onClick={() => setPending("end")} className={BTN.ghost}><Timer size={16} aria-hidden="true" />{tr("End now")}</button>}
          {(live || soldOpen) && <button type="button" onClick={() => onEdit(auction)} className={BTN.primary}><Pencil size={16} aria-hidden="true" />{tr("Edit")}</button>}
          <button type="button" onClick={onClose} className={BTN.ghost}>{tr("Close")}</button>
        </>}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="min-w-0 space-y-4">
            <div className="relative overflow-hidden rounded-2xl bg-navy-900 ring-1 ring-line">
              {gallery[photo] ? <img decoding="async" src={gallery[photo]} alt={auction.title} className="aspect-[4/3] max-h-[32dvh] w-full object-cover lg:max-h-none" /> : <div className="flex aspect-[4/3] items-center justify-center text-[13px] text-navy-200">{tr("No photo")}</div>}
              <span className="absolute left-3 top-3"><StatusPill tone={STAGE_TONE[auction.stage] ?? "slate"}>{statusLabel(auction)}</StatusPill></span>
            </div>
            {gallery.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {gallery.map((url, index) => (
                  <button key={url} type="button" onClick={() => setPhoto(index)} aria-label={tr("Photo {0}", { "0": index + 1 })} aria-current={photo === index} className={`size-16 shrink-0 overflow-hidden rounded-xl ring-2 transition ${photo === index ? "ring-gold-500" : "ring-transparent opacity-70 hover:opacity-100"}`}>
                    <img decoding="async" src={url} alt="" loading="lazy" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <DetailGrid items={[
              ["Current bid", peso(auction.current_price)],
              ["Starting bid", peso(auction.starting_price)],
              ["Bid increment", peso(auction.bid_increment)],
              ["Buy Now price", auction.buyout_price ? peso(auction.buyout_price) : "—"],
              ["Bids placed", String(auction.bid_count)],
              [auction.status === "live" ? "Time left" : auction.status === "scheduled" ? "Opens" : "Closed", timeText],
              ["Closes at", formatDateTime(auction.ends_at)],
              ["Anti-snipe", auction.anti_snipe_enabled ? tr("{0} min window, +{1} min", { "0": Math.round(auction.anti_snipe_window_seconds / 60), "1": Math.round(auction.anti_snipe_extension_seconds / 60) }) : tr("Off")],
              ["Extensions used", `${auction.extension_count} / ${auction.max_extensions}`],
            ]} />
            {awaiting && (
              <div className="rounded-2xl border border-iris-300/70 bg-iris-50 px-4 py-3.5 text-[14px] leading-6 text-ink-soft dark:bg-iris-500/10" role="status">
                <p className="font-semibold text-ink">{auction.bought_out ? tr("A bidder used Buy Now and the auction ended at once. Confirm the purchase.") : tr("Bidding is closed. The result needs your decision.")}</p>
                <p className="mt-1">{tr("Confirming only says who won. The winner is told to pay and collect the item, and the auction stays open as Awaiting pickup until you press Complete auction. If they never collect, you can re-auction it.")}</p>
              </div>
            )}
            {auction.reauctioned_from && <p className="rounded-2xl border border-line bg-frost-50 px-4 py-3 text-[13.5px] leading-6 text-ink-soft">{tr("This is a re-auction of an earlier sale.")}{auction.reauction_reason ? ` ${auction.reauction_reason}` : ""}</p>}
            {auction.status === "cancelled" && auction.cancel_reason && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] leading-6 text-rose-800">{tr("Cancelled: {0}", { "0": auction.cancel_reason })}</p>}
          </div>

          <div className="min-w-0 space-y-4">
            <SegmentedFilter label="Auction activity" value={tab} onChange={setTab} options={tabs} />

            {tab === "bids" && (detail.bids.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line-strong px-5 py-10 text-center text-[14px] text-ink-muted">{tr("No bids yet. The first bid must be at least the starting bid.")}</p>
            ) : (
              <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {detail.bids.map((bid, index) => (
                  <li key={bid.id} className={`flex items-center gap-3 px-4 py-3 ${index === 0 ? "bg-gold-50" : ""}`}>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-frost-100 text-[12.5px] font-bold tabular-nums text-ink-soft">{index === 0 ? <Trophy size={15} className="text-gold-600" aria-hidden="true" /> : detail.bids.length - index}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold text-ink">{bid.name}</span>
                      <span className="block text-[12.5px] text-ink-muted">{bid.campus_id || "—"} · {formatDateTime(bid.created_at)}</span>
                    </span>
                    <span className="font-[family-name:var(--font-heading)] text-[17px] font-semibold tabular-nums text-ink">{peso(bid.amount)}</span>
                  </li>
                ))}
              </ol>
            ))}

            {tab === "comments" && (detail.comments.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line-strong px-5 py-10 text-center text-[14px] text-ink-muted">{tr("No comments yet.")}</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {detail.comments.map((comment) => (
                  <li key={comment.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink-muted"><span className="font-semibold text-ink">{comment.name}</span> · {comment.campus_id || "—"} · {formatDateTime(comment.created_at)}{comment.hidden && <span className="ml-2 font-semibold text-rose-600">{tr("Hidden")}</span>}</p>
                      <p className={`mt-1 break-words text-[14.5px] leading-6 ${comment.hidden ? "text-ink-muted line-through" : "text-ink-soft"}`}>{comment.body}</p>
                    </div>
                    <button type="button" disabled={busy} onClick={() => void run(() => moderateAuctionComment(auction.id, comment.id, !comment.hidden))} aria-label={comment.hidden ? tr("Restore comment") : tr("Hide comment")} title={comment.hidden ? tr("Restore comment") : tr("Hide comment")} className="icon-action shrink-0">
                      {comment.hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            ))}

            {tab === "hearts" && (!detail.reactors || detail.reactors.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line-strong px-5 py-10 text-center text-[14px] text-ink-muted">{tr("No one has hearted this lot yet.")}</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {detail.reactors.map((person) => (
                  <li key={`${person.name}-${person.created_at}`} className="flex items-center gap-3 px-4 py-3">
                    <Heart size={16} className="shrink-0 text-rose-500" fill="currentColor" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold text-ink">{person.name}</span>
                      <span className="block text-[12.5px] text-ink-muted">{person.campus_id || "—"} · {formatDateTime(person.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ))}

            {tab === "pickup" && awaiting && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-gold-300/60 bg-gold-50 p-4 dark:bg-gold-500/10">
                  <p className="text-[13px] font-medium text-ink-muted">{tr("Highest bid")}</p>
                  <p className="font-[family-name:var(--font-heading)] text-[30px] font-semibold tabular-nums text-ink">{peso(auction.current_price)}</p>
                </div>
                <DetailGrid items={[
                  ["Leading bidder", bidder?.name ?? "—"],
                  ["Campus ID", bidder?.campus_id ?? "—"],
                  ["Email", bidder?.email ?? "—"],
                  ["Bids placed", String(auction.bid_count)],
                ]} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setPending("finalize")} className={BTN.success}><CheckCheck size={16} aria-hidden="true" />{tr("Confirm winner")}</button>
                  {bidder && <button type="button" onClick={() => setSuspendOpen(true)} className={BTN.ghost}><UserX size={16} aria-hidden="true" />{tr("Suspend bidder")}</button>}
                </div>
              </div>
            )}

            {tab === "pickup" && auction.sold && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-gold-300/60 bg-gold-50 p-4">
                  <p className="text-[13px] font-medium text-ink-muted">{tr("Winning bid")}</p>
                  <p className="font-[family-name:var(--font-heading)] text-[30px] font-semibold tabular-nums text-ink">{peso(auction.winning_amount)}</p>
                </div>
                <DetailGrid items={[
                  ["Winner", auction.winner_detail?.name ?? "—"],
                  ["Campus ID", auction.winner_detail?.campus_id ?? "—"],
                  ["Email", auction.winner_detail?.email ?? "—"],
                  ["Pickup status", auction.fulfillment_status === "collected" ? tr("Completed: paid and collected") : auction.fulfillment_status === "forfeited" ? tr("Forfeited, back in custody") : tr("Awaiting pickup and payment")],
                ]} />
                <p className={`rounded-2xl border px-4 py-3 text-[13.5px] leading-6 ${emailFailed ? "border-rose-200 bg-rose-50 text-rose-800" : "border-line bg-frost-50 text-ink-soft"}`} role={emailFailed ? "alert" : undefined}>{email}</p>
                {auction.reauction_ready && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] leading-6 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-[#fecdd3]" role="status">
                    <p className="font-semibold">{tr("Ready for re-auction")}</p>
                    <p className="mt-1">{tr("The winner did not collect within 72 hours. The win was forfeited automatically, the item is back in custody and the winner cannot bid for 30 days.")}</p>
                    <button type="button" onClick={() => setReauctionOpen(true)} className={`${BTN.gold} mt-3`}><Repeat2 size={16} aria-hidden="true" />{tr("Re-auction this item")}</button>
                  </div>
                )}
                {auction.pickup_warning_sent_at && auction.fulfillment_status === "awaiting_pickup" && (
                  <p className="rounded-2xl border border-line bg-frost-50 px-4 py-3 text-[13.5px] leading-6 text-ink-soft">{tr("A 24-hour final warning was emailed to the winner. The win is forfeited automatically 72 hours after the winner notice.")}</p>
                )}
                {(auction.fulfillment_status === "awaiting_pickup" || auction.fulfillment_status === "collected") && (
                  <button type="button" disabled={busy} onClick={() => void run(() => resendAdminWinnerEmail(auction.id))} className={BTN.ghost}><Mail size={16} aria-hidden="true" />{tr("Resend winner email")}</button>
                )}
                {auction.fulfillment_status === "awaiting_pickup" && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setPending("collected")} className={BTN.success}><PackageCheck size={16} aria-hidden="true" />{tr("Complete auction")}</button>
                    <button type="button" onClick={() => setPending("extend")} className={BTN.ghost}><Hourglass size={16} aria-hidden="true" />{tr("Give the winner more time")}</button>
                    <button type="button" onClick={() => setReauctionOpen(true)} className={BTN.ghost}><Repeat2 size={16} aria-hidden="true" />{tr("Winner flaked: re-auction")}</button>
                    {auction.winner_detail && <button type="button" onClick={() => setSuspendOpen(true)} className={BTN.ghost}><UserX size={16} aria-hidden="true" />{tr("Suspend winner")}</button>}
                    <button type="button" onClick={() => setPending("forfeited")} className={BTN.ghost}><Undo2 size={16} aria-hidden="true" />{tr("Forfeit and return to custody")}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </AdminModal>

      {cancelOpen && (
        <AdminModal
          title={tr("Cancel this auction?")}
          description={tr("Bidding stops and the leading bidder is told. The item goes back to unclaimed custody.")}
          icon={<Ban size={19} />} tone="danger" size="sm" busy={busy} onClose={() => setCancelOpen(false)}
          footer={<>
            <button type="button" onClick={() => setCancelOpen(false)} disabled={busy} className={BTN.ghost}>{tr("Keep auction")}</button>
            <button type="button" disabled={busy} onClick={() => void run(() => cancelAdminAuction(auction.id, cancelReason))} className={BTN.danger}>{tr("Cancel auction")}</button>
          </>}
        >
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Reason (bidders see this)")}</span>
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} maxLength={300} data-autofocus placeholder={tr("The owner came forward to claim the item.")} className={`${INPUT} resize-y py-3 leading-6`} />
          </label>
        </AdminModal>
      )}

      {reauctionOpen && <ReauctionModal auction={auction} onClose={() => setReauctionOpen(false)} onDone={() => { onChanged(); onClose(); }} />}

      {suspendOpen && bidder && (
        <SuspendUserModal
          accountId={bidder.account_id}
          name={bidder.name}
          defaultReason={`Did not complete an auction purchase (${auction.reference || auction.title}).`}
          onClose={() => setSuspendOpen(false)}
          onDone={() => { onChanged(); void load(); }}
        />
      )}

      {pending === "finalize" && (
        <AdminModal
          title={tr("Confirm the winner?")}
          description={tr("This confirms who won. The auction is not complete until the winner has paid and collected the item.")}
          icon={<CheckCheck size={19} />} tone="mint" size="sm" busy={busy} onClose={() => setPending(null)}
          footer={<>
            <button type="button" onClick={() => setPending(null)} disabled={busy} className={BTN.ghost}>{tr("Back")}</button>
            <button type="button" disabled={busy} onClick={() => void run(() => finalizeAdminAuction(auction.id))} className={BTN.success}>{busy ? tr("Working…") : tr("Confirm winner")}</button>
          </>}
        >
          {auction.pending_claim && (
            <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] leading-6 text-rose-800">
              {tr("Someone has filed an ownership claim on this item. Decide that claim first: approving it cancels this auction, and confirming a winner would promise the item to two people.")}
            </p>
          )}
          <div className="rounded-2xl border border-gold-300/60 bg-gold-50 px-4 py-4 dark:bg-gold-500/10">
            <p className="text-[13px] font-medium text-ink-muted">{bidder?.name ?? "—"}</p>
            <p className="font-[family-name:var(--font-heading)] text-[28px] font-semibold tabular-nums text-ink">{peso(auction.current_price)}</p>
          </div>
          <ul className="mt-4 space-y-1.5 text-[14px] leading-6 text-ink-soft">
            <li>{tr("The winner is notified to collect and pay at the Lost and Found Office.")}</li>
            <li>{tr("The item is marked as auctioned and the auction becomes Awaiting pickup.")}</li>
            <li>{tr("After the winner has paid and collected, press Complete auction. If they do not show up, you can edit the listing, give them more time or re-auction it.")}</li>
          </ul>
        </AdminModal>
      )}

      {pending && pending !== "finalize" && (
        <ConfirmActionDialog
          title={{ end: "end this auction now?", delete: "delete this auction and its bids?", collected: "complete this auction?", forfeited: "forfeit this sale?", archive: "archive this auction?", unarchive: "restore this auction from the archive?", extend: "give the winner more time?" }[pending]}
          description={{
            end: "The highest bid wins immediately and the winner is notified.",
            delete: "This moves the auction, its bids and its comments to the Recycle bin. A super admin can restore them.",
            collected: "Confirm the winner paid and took the item from the Lost and Found Office. This completes the auction and closes the found report.",
            forfeited: "The winner did not collect. The item returns to unclaimed custody so it can be claimed or auctioned again.",
            archive: "It moves out of the working list into the Archived tab. Nothing is deleted and you can restore it any time.",
            unarchive: "It goes back to the working list.",
            extend: "The winner gets a fresh pickup window (the 48 hour warning and 72 hour forfeit start again) and is told.",
          }[pending]}
          confirmLabel={{ end: "End auction", delete: "Delete auction", collected: "Complete auction", forfeited: "Forfeit sale", archive: "Archive", unarchive: "Restore", extend: "Give more time" }[pending]}
          danger={pending === "delete" || pending === "forfeited"}
          busy={busy}
          onCancel={() => { if (!busy) setPending(null); }}
          onConfirm={() => void run(
            pending === "end" ? () => endAdminAuction(auction.id)
              : pending === "delete" ? () => deleteAdminAuction(auction.id)
                : pending === "archive" || pending === "unarchive" ? () => setArchived("auction", auction.id, pending === "archive")
                  : pending === "extend" ? () => extendAdminAuctionPickup(auction.id)
                    : () => setAdminAuctionFulfillment(auction.id, pending),
            pending === "delete",
          )}
        />
      )}
    </>
  );
}
