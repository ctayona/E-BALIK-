import { useId, useState } from "react";
import { Eye, EyeOff, Mail, Phone, ShieldAlert, UserRound } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import DataPrivacyConsent from "@/app/shared/privacy/DataPrivacyConsent";
import ItemTypePicker from "@/app/shared/tags/ItemTypePicker";
import LivePhotoField from "@/app/shared/tags/LivePhotoField";
import { CX } from "@/app/utils/clay";
import { useCurrentUser } from "@/app/utils/system";
import type { OwnerTag, TagDetailsInput } from "@/app/utils/tags";

function Switch({ checked, onChange, label, hint, icon }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint: string; icon: React.ReactNode }) {
  const id = useId();
  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-3.5 transition-colors ${checked ? "border-gold-300 bg-gold-50" : "border-line bg-white"}`}>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${checked ? "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" : "bg-frost-100 text-ink-muted"}`} aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-[14.5px] font-semibold text-ink">{label}</label>
        <span className="block text-[12.5px] leading-5 text-ink-muted">{hint}</span>
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iris-500 ${checked ? "bg-gold-500" : "bg-slate-300"}`}
      >
        <span className={`absolute left-0.5 top-0.5 size-6 rounded-full bg-[#ffffff] shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

/**
 * The form for registering a tag and for editing it later. The live preview shows exactly what a finder will see,
 * so the privacy switches are never a guess.
 */
export default function TagDetailsForm({ initial, mode, submitLabel, busy, error, onSubmit, onCancel }: {
  initial?: Partial<OwnerTag>;
  mode: "claim" | "edit";
  submitLabel: string;
  busy: boolean;
  error?: string;
  /** `photo` is the picture taken live with the camera. It is required when registering and optional when editing. */
  onSubmit: (values: TagDetailsInput, consent: boolean, photo: File | null) => void;
  onCancel?: () => void;
}) {
  const user = useCurrentUser();
  const [name, setName] = useState(initial?.item_name ?? "");
  const [description, setDescription] = useState(initial?.item_description ?? "");
  const [showName, setShowName] = useState(initial?.show_name ?? true);
  const [showEmail, setShowEmail] = useState(initial?.show_email ?? true);
  const [showPhone, setShowPhone] = useState(initial?.show_phone ?? false);
  const [phone, setPhone] = useState(initial?.contact_phone ?? "");
  const [consent, setConsent] = useState(mode === "edit");
  const [problem, setProblem] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [review, setReview] = useState<{ values: TagDetailsInput; photo: File } | null>(null);

  const fullName = `${user?.fname ?? ""} ${user?.lname ?? ""}`.trim() || "Your name";
  const shown = [showName && fullName, showEmail && (user?.email || "your email"), showPhone && (phone || "your phone number")].filter(Boolean) as string[];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) { setProblem("Choose what this tag is attached to. If it is not in the list, choose Other and type its name."); return; }
    if (showPhone && !phone.trim()) { setProblem("Add a phone number, or switch \"Show my phone number\" off."); return; }
    if (mode === "claim" && !photo) { setProblem("Take a photo of your item with the sticker attached before registering."); return; }
    setProblem("");
    const values: TagDetailsInput = { item_name: name.trim(), item_description: description.trim(), show_name: showName, show_email: showEmail, show_phone: showPhone, contact_phone: phone.trim() };
    // Registering is final for the item name, so the user must confirm before anything is sent.
    if (mode === "claim" && photo) { setReview({ values, photo }); return; }
    onSubmit(values, consent, photo);
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <ItemTypePicker value={name} onChange={setName} locked={mode === "edit" && initial?.item_name_locked !== false && Boolean(initial?.item_name)} />
      <div>
        <label htmlFor="tag-item-desc" className={CX.label}>Description <span className="font-normal text-ink-muted">(optional)</span></label>
        <textarea id="tag-item-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} placeholder="Brand, colour, stickers, scratches. Anyone who scans the tag can read this." className={`${CX.input} w-full resize-y py-3 leading-6`} />
      </div>

      <LivePhotoField file={photo} existingUrl={initial?.photo_url} onChange={setPhoto} required={mode === "claim"} />
      {mode === "edit" && photo && initial?.status !== "pending_verification" && (
        <p className="-mt-2 flex items-start gap-2 rounded-2xl border border-[#f5c451] bg-[#fef3c7] px-4 py-3 text-[13.5px] leading-6 text-[#78350f]" role="status"><ShieldAlert size={16} className="mt-1 shrink-0" aria-hidden="true" />Saving a new photo needs staff approval. Your tag stops working and finders see nothing until staff approve it.</p>
      )}

      <fieldset className="space-y-2.5">
        <legend className={CX.label}>What may a finder see?</legend>
        <Switch checked={showName} onChange={setShowName} label="Show my name" hint="So the finder knows who to look for." icon={<UserRound size={18} />} />
        <Switch checked={showEmail} onChange={setShowEmail} label="Show my email" hint="Lets the finder write to you directly." icon={<Mail size={18} />} />
        <Switch checked={showPhone} onChange={setShowPhone} label="Show my phone number" hint="Off by default. Only switch it on if you are comfortable with strangers calling." icon={<Phone size={18} />} />
        {(showPhone || phone) && (
          <div>
            <label htmlFor="tag-phone" className={CX.label}>Phone number</label>
            <input id="tag-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} placeholder="0917 123 4567" autoComplete="tel" className={`${CX.input} w-full`} />
          </div>
        )}
      </fieldset>

      <div className="rounded-2xl border border-iris-200 bg-iris-50 p-4" aria-live="polite">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-iris-700">{shown.length ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}What a finder will see</p>
        {(photo || initial?.photo_url) && <p className="mt-1 text-[13px] text-ink-soft">The photo is shown too, so the finder can match the item to the sticker.</p>}
        <p className="mt-1 text-[14px] font-semibold text-ink">{name.trim() || "Your item"}</p>
        <p className="mt-0.5 text-[13.5px] leading-6 text-ink-soft">{shown.length ? shown.join(" · ") : "No contact details. Finders can still press \"I found this item\" and E-Balik will notify you."}</p>
      </div>

      {mode === "claim" && <DataPrivacyConsent checked={consent} onChange={setConsent} purpose="register this Smart Tag and share the details I chose with anyone who scans it" />}

      {(problem || error) && <p role="alert" className={CX.alertError}>{problem || error}</p>}

      <Modal
        open={Boolean(review)}
        onClose={() => setReview(null)}
        size="sm"
        tone="gold"
        icon={<ShieldAlert size={21} />}
        eyebrow="Before you register"
        title="Confirm your details"
        footer={<>
          <button type="button" onClick={() => setReview(null)} className={CX.btnGhost}>Go back and check</button>
          <button type="button" data-autofocus onClick={() => { const pending = review; setReview(null); if (pending) onSubmit(pending.values, consent, pending.photo); }} className={CX.btnGold}>Confirm Registration</button>
        </>}
      >
        {review && (
          <div className="space-y-4">
            <p className="rounded-2xl border border-gold-300 bg-gold-50 px-4 py-3.5 text-[14.5px] leading-6 text-ink-soft">Please confirm your details are accurate. To prevent fraud, you will not be able to change the Item Name once this tag is registered, and changing the photo later will require staff re-approval.</p>
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-frost-50 p-3">
              <img src={URL.createObjectURL(review.photo)} alt="" className="size-16 shrink-0 rounded-xl border border-line object-cover" onLoad={(event) => URL.revokeObjectURL(event.currentTarget.src)} />
              <div className="min-w-0"><p className="text-[12.5px] font-medium text-ink-muted">Item</p><p className="truncate text-[16px] font-semibold text-ink">{review.values.item_name}</p></div>
            </div>
            <p className="text-[13px] leading-5 text-ink-muted">After you confirm, bring the item and its sticker to the Lost and Found Office. The tag starts working once staff have checked it.</p>
          </div>
        )}
      </Modal>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-col-reverse gap-2 border-t border-line bg-white/85 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:flex-row sm:justify-end">
        {onCancel && <button type="button" onClick={onCancel} disabled={busy} className={CX.btnGhost}>Cancel</button>}
        <button type="submit" disabled={busy || (mode === "claim" && (!consent || !photo))} className={CX.btnGold}>{busy ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
