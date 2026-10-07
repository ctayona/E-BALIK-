import { useEffect, useState } from "react";
import { Camera, Pencil } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT } from "../../components/ui/primitives";
import { editSmartTag, type AdminSmartTag } from "../../utils/smartTagsApi";
import { tr } from "../../utils/preferences";

const SPACED = (code: string) => code.replace(/(.{4})/g, "$1 ").trim();

/** Staff edit: every field of a registered tag, including the item name and the photo. It never changes the approval state. */
export default function AdminTagEditModal({ tag, onClose, onSaved }: { tag: AdminSmartTag; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tag.item_name);
  const [description, setDescription] = useState(tag.item_description ?? "");
  const [showName, setShowName] = useState(Boolean(tag.show_name));
  const [showEmail, setShowEmail] = useState(Boolean(tag.show_email));
  const [showPhone, setShowPhone] = useState(Boolean(tag.show_phone));
  const [phone, setPhone] = useState(tag.contact_phone ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!photo) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const valid = name.trim().length >= 2 && (!showPhone || phone.trim().length > 0);

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await editSmartTag(tag.tag_id, { item_name: name.trim(), item_description: description.trim(), show_name: showName, show_email: showEmail, show_phone: showPhone, contact_phone: phone.trim() }, photo);
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to save the changes."));
    } finally {
      setBusy(false);
    }
  };

  const check = (checked: boolean, set: (value: boolean) => void, label: string) => (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3.5 text-[14px] text-ink-soft">
      <input type="checkbox" checked={checked} onChange={(event) => set(event.target.checked)} className="size-4 accent-gold-600" />{label}
    </label>
  );

  return (
    <AdminModal
      title={tr("Edit {0}", { "0": SPACED(tag.tag_id) })}
      description={tr("Staff can change everything, including the item name and photo. Changes apply at once and never need approval.")}
      icon={<Pencil size={19} />}
      size="lg"
      busy={busy}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
        <button type="button" onClick={() => void save()} disabled={!valid || busy} className={BTN.primary}>{busy ? tr("Saving…") : tr("Save changes")}</button>
      </>}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Item name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className={INPUT} data-autofocus />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Description")}</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500} className={`${INPUT} resize-y py-3 leading-6`} />
        </label>
        <fieldset>
          <legend className="mb-1.5 text-[14px] font-semibold text-ink-soft">{tr("What a finder may see")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {check(showName, setShowName, tr("Owner's name"))}
            {check(showEmail, setShowEmail, tr("Owner's email"))}
            {check(showPhone, setShowPhone, tr("Phone number"))}
          </div>
        </fieldset>
        {(showPhone || phone) && (
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Phone number")}</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" maxLength={30} className={INPUT} />
          </label>
        )}
        <div>
          <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Replace the photo")}</span>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line-strong p-3">
            {preview ? <img src={preview} alt={tr("The new photo")} className="size-20 rounded-xl border border-line object-cover" /> : <span className="flex size-20 items-center justify-center rounded-xl bg-frost-100 text-ink-muted"><Camera size={22} aria-hidden="true" /></span>}
            <div className="min-w-0 flex-1">
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} className="block w-full text-[13.5px] text-ink-soft file:mr-3 file:min-h-[40px] file:rounded-xl file:border file:border-line-strong file:bg-[var(--surface)] file:px-4 file:text-[13.5px] file:font-semibold file:text-ink" aria-label={tr("Choose a new photo")} />
              <p className="mt-1 text-[12.5px] text-ink-muted">{tr("Optional. JPG, PNG or WebP up to 5 MB. A new photo here replaces the current one and clears any photo the owner submitted.")}</p>
            </div>
          </div>
        </div>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-[#fecdd3]">{error}</p>}
      </div>
    </AdminModal>
  );
}
