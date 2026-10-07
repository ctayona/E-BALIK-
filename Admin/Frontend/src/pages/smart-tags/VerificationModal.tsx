import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Mail, Maximize2, Phone, ShieldCheck, UserRound, X, XCircle } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { BTN, INPUT } from "../../components/ui/primitives";
import { StatusPill } from "../../components/ui/management";
import { approveSmartTag, fetchSmartTagPhoto, rejectSmartTag, type AdminSmartTag, type TagPhotos } from "../../utils/smartTagsApi";
import { formatDateTime } from "../../utils/countdown";
import { tr } from "../../utils/preferences";

const SPACED = (code: string) => code.replace(/(.{4})/g, "$1 ").trim();

/**
 * The screen staff use with the real item in front of them: the submitted item name, who submitted it and the live
 * photo, all large, then Approve or Reject. A new photo of an already approved tag also shows the previous photo.
 */
export default function VerificationModal({ tag, onClose, onDone }: { tag: AdminSmartTag; onClose: () => void; onDone: () => void }) {
  const [photos, setPhotos] = useState<TagPhotos | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setPhotos(null);
    setPhotoError(false);
    fetchSmartTagPhoto(tag.tag_id).then((value) => { if (active) setPhotos(value); }).catch(() => { if (active) setPhotoError(true); });
    return () => { active = false; };
  }, [tag.tag_id]);

  const decide = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      onDone();
      onClose();
    } catch {
      // The API helper already showed the reason in the result dialog; stay here so staff can retry.
    } finally {
      setBusy(false);
    }
  };

  const shared = [tag.show_name && tr("name"), tag.show_email && tr("email"), tag.show_phone && tr("phone")].filter(Boolean) as string[];

  return (
    <>
      <AdminModal
        title={tr("Verify this Smart Tag")}
        description={tr("Compare this screen with the item in front of you, then approve or reject.")}
        icon={<ShieldCheck size={20} />}
        tone="gold"
        size="xl"
        busy={busy}
        onClose={onClose}
        footer={rejecting ? (
          <>
            <button type="button" onClick={() => setRejecting(false)} disabled={busy} className={BTN.ghost}>{tr("Back")}</button>
            <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void decide(() => rejectSmartTag(tag.tag_id, reason.trim()))} className={BTN.danger}><XCircle size={17} aria-hidden="true" />{busy ? tr("Working…") : tr("Send rejection")}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onClose} disabled={busy} className={`${BTN.ghost} sm:mr-auto`}>{tr("Decide later")}</button>
            <button type="button" onClick={() => { setReason(""); setRejecting(true); }} disabled={busy} className={BTN.danger}><XCircle size={17} aria-hidden="true" />{tr("Reject")}</button>
            <button type="button" onClick={() => void decide(() => approveSmartTag(tag.tag_id))} disabled={busy || photoError} className={`${BTN.success} min-h-[46px] px-6`}><CheckCircle2 size={18} aria-hidden="true" />{busy ? tr("Working…") : tr("Approve")}</button>
          </>
        )}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <figure className="relative overflow-hidden rounded-2xl border border-line bg-navy-950 shadow-card">
              {photos?.url ? (
                <button type="button" onClick={() => setZoom(true)} className="group relative block w-full cursor-zoom-in" aria-label={tr("Open the photo full size")}>
                  <img src={photos.url} alt={tr("Photo of the item with its sticker, taken live by the owner")} className="max-h-[62vh] min-h-[260px] w-full object-contain" onError={() => setPhotoError(true)} />
                  <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[12.5px] font-medium text-[#ffffff] opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Maximize2 size={13} aria-hidden="true" />{tr("Full size")}</span>
                </button>
              ) : photoError || (photos && !photos.url) ? <p className="px-4 py-20 text-center text-[14px] text-[#fecdd3]">{tr("The photo could not be loaded. Do not approve a tag without seeing its photo.")}</p>
                : <SkeletonBlock className="h-[320px] w-full rounded-none" />}
              {photos?.is_new_photo && <span className="absolute left-3 top-3 rounded-full bg-gold-500 px-3 py-1 text-[12.5px] font-bold text-navy-950 shadow">{tr("New photo")}</span>}
            </figure>
            <p className="text-[12.5px] text-ink-muted">{tr("Taken live with the owner's camera, not picked from the gallery.")}</p>
            {photos?.previous_url && (
              <div className="flex items-center gap-3 rounded-2xl border border-line bg-frost-50 p-3">
                <img src={photos.previous_url} alt={tr("The previously approved photo")} className="size-20 shrink-0 rounded-xl border border-line object-cover" />
                <div className="min-w-0"><p className="text-[13.5px] font-semibold text-ink">{tr("Previously approved photo")}</p><p className="text-[12.5px] leading-5 text-ink-muted">{tr("If the item changed, reject the new photo. The tag keeps working with this one.")}</p></div>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="gold">{tr("Pending approval")}</StatusPill>
              <StatusPill tone="slate">{tag.is_reregistration ? tr("New photo for an active tag") : tr("First registration")}</StatusPill>
            </div>

            <section className="rounded-2xl border border-gold-300/70 bg-gold-50 p-4 dark:border-gold-500/30 dark:bg-gold-500/10">
              <p className="text-[12.5px] font-semibold text-ink-muted">{tr("Item name")}</p>
              <p className="mt-1 break-words font-[family-name:var(--font-heading)] text-[30px] font-semibold leading-tight text-ink">{tag.item_name || "—"}</p>
              {tag.item_description && <p className="mt-2 whitespace-pre-line break-words text-[14px] leading-6 text-ink-soft">{tag.item_description}</p>}
            </section>

            <section className="rounded-2xl border border-line bg-frost-50 p-4">
              <p className="text-[12.5px] font-semibold text-ink-muted">{tr("Submitted by")}</p>
              <p className="mt-1 flex items-center gap-2 break-words font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight text-ink"><UserRound size={20} className="shrink-0 text-gold-600" aria-hidden="true" />{tag.owner?.name || "—"}</p>
              <dl className="mt-2 space-y-1 text-[13.5px] text-ink-soft">
                <div className="flex items-center gap-2"><Mail size={14} className="shrink-0 text-ink-muted" aria-hidden="true" /><dd className="min-w-0 truncate" title={tag.owner?.email}>{tag.owner?.email || "—"}</dd></div>
                <div className="flex items-center gap-2"><dt className="text-ink-muted">{tr("Campus ID")}</dt><dd className="font-mono">{tag.owner?.campus_id || "—"}</dd></div>
                {tag.show_phone && tag.contact_phone && <div className="flex items-center gap-2"><Phone size={14} className="shrink-0 text-ink-muted" aria-hidden="true" /><dd>{tag.contact_phone}</dd></div>}
              </dl>
            </section>

            <dl className="grid grid-cols-2 gap-3 text-[13.5px]">
              <div className="rounded-xl border border-line px-3.5 py-2.5"><dt className="text-[12px] text-ink-muted">{tr("Tag code")}</dt><dd className="font-mono font-semibold text-ink">{SPACED(tag.tag_id)}</dd></div>
              <div className="rounded-xl border border-line px-3.5 py-2.5"><dt className="flex items-center gap-1 text-[12px] text-ink-muted"><Clock3 size={12} aria-hidden="true" />{tr("Submitted")}</dt><dd className="font-semibold text-ink">{tag.submitted_at ? formatDateTime(tag.submitted_at) : "—"}</dd></div>
            </dl>
            <p className="text-[12.5px] leading-5 text-ink-muted">{shared.length ? tr("Finders will see the owner's {0} once approved.", { "0": shared.join(", ") }) : tr("The owner chose not to show any contact details to finders.")}</p>

            {rejecting ? (
              <label className="block">
                <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Reason (the owner sees this)")}</span>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={300} data-autofocus placeholder={tr("The item does not match the photo, or the sticker is not on it.")} className={`${INPUT} resize-y py-3 leading-6`} />
                <span className="mt-1 block text-[12.5px] text-ink-muted">{tag.is_reregistration ? tr("The tag goes back to its previous photo and stays active.") : tr("The registration is cleared and the sticker can be registered again.")}</span>
              </label>
            ) : (
              <ul className="space-y-1.5 text-[13px] leading-5 text-ink-soft">
                <li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#2fae8e]" aria-hidden="true" />{tr("The item in front of you matches the name and photo.")}</li>
                <li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#2fae8e]" aria-hidden="true" />{tr("The Smart Tag sticker is on the item and the code matches.")}</li>
                <li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#2fae8e]" aria-hidden="true" />{tr("The person is the one named above (check their ID).")}</li>
              </ul>
            )}
          </div>
        </div>
      </AdminModal>

      {zoom && photos?.url && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label={tr("Photo full size")} onClick={() => setZoom(false)}>
          <img src={photos.url} alt={tr("Photo of the item with its sticker, taken live by the owner")} className="max-h-full max-w-full rounded-xl object-contain" />
          <button type="button" onClick={() => setZoom(false)} aria-label={tr("Close")} className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-white/15 text-[#ffffff] backdrop-blur hover:bg-white/25"><X size={20} aria-hidden="true" /></button>
        </div>
      )}
    </>
  );
}
