import { useCallback, useEffect, useState } from "react";
import { Camera, Loader2, QrCode } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import ScanCodeButton from "@/app/shared/tags/ScanCodeButton";
import TagDetailsForm from "@/app/shared/tags/TagDetailsForm";
import { CX } from "@/app/utils/clay";
import { TagRequestError, extractTagCode, spacedCode, tagsApi, type OwnerTag, type PublicTag, type TagDetailsInput } from "@/app/utils/tags";

const WHY_NOT: Record<string, string> = {
  disabled: "This Smart Tag was deactivated and cannot be registered.",
  expired: "This Smart Tag has expired and cannot be registered.",
  inactive: "This Smart Tag is no longer active.",
};

/**
 * Register a new Smart Tag without leaving the page: enter or scan the code, then fill in the details and take the
 * live photo of the item with the sticker on it. Same rules as the public scan page: the server decides everything.
 */
export default function RegisterTagModal({ open, initialCode, onClose, onRegistered }: {
  open: boolean;
  initialCode?: string;
  onClose: () => void;
  onRegistered: (tag: OwnerTag) => void;
}) {
  const [step, setStep] = useState<"code" | "details">("code");
  const [code, setCode] = useState("");
  const [tagCode, setTagCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const check = useCallback(async (raw: string) => {
    const clean = extractTagCode(raw);
    if (!clean) { setCodeError("That does not look like a tag code. Enter the 10 to 12 characters printed on the sticker, or paste its link."); return; }
    setChecking(true);
    setCodeError("");
    try {
      const tag: PublicTag = await tagsApi.view(clean);
      if (tag.status === "blank") { setTagCode(clean); setStep("details"); return; }
      if (tag.is_owner) setCodeError("This tag is already yours. You can find it in your list.");
      else if (WHY_NOT[tag.status]) setCodeError(WHY_NOT[tag.status]);
      else setCodeError("This Smart Tag is already registered to someone else.");
    } catch (reason) {
      setCodeError(reason instanceof TagRequestError && reason.status === 404 ? "No Smart Tag has that code. Check the code printed on the sticker." : reason instanceof Error ? reason.message : "Unable to check the code.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setFormError("");
    setCodeError("");
    setSaving(false);
    setStep("code");
    setTagCode("");
    setCode(initialCode ?? "");
    if (initialCode) void check(initialCode);
  }, [open, initialCode, check]);

  const claim = async (values: TagDetailsInput, consent: boolean, photo: File | null) => {
    if (!photo) { setFormError("Take a photo of your item with the sticker attached before registering."); return; }
    setSaving(true);
    setFormError("");
    try {
      const result = await tagsApi.claim(tagCode, { ...values, dpa_consent: consent }, photo);
      onRegistered(result.tag);
      onClose();
      showInfoModal({ variant: "success", title: "Smart Tag submitted", message: `"${result.tag.item_name}" is waiting for staff approval.`, details: ["Bring the item with the sticker on it to the Lost and Found Office.", "Staff compare it with your photo, then the tag starts working.", "Until then finders cannot see anything about it."] });
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Unable to register this tag.");
      if (reason instanceof TagRequestError && reason.code === "already_claimed") { setStep("code"); setCodeError("This Smart Tag is already registered to someone."); }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      dismissible={!saving}
      size="md"
      tone="gold"
      icon={step === "code" ? <QrCode size={21} /> : <Camera size={21} />}
      eyebrow={step === "details" ? `Tag ${spacedCode(tagCode)}` : "Register a Smart Tag"}
      title={step === "code" ? "Which sticker is it?" : "Describe it and take a photo"}
      description={step === "code" ? "Enter the code printed on the sticker, or scan its QR code." : "You will take a live photo of your item with the sticker attached."}
    >
      {step === "code" ? (
        <form onSubmit={(event) => { event.preventDefault(); void check(code); }} className="space-y-4" noValidate>
          <div>
            <label htmlFor="register-tag-code" className={CX.label}>Tag code</label>
            <div className="flex gap-2">
              <input id="register-tag-code" value={code} onChange={(event) => { setCode(event.target.value); setCodeError(""); }} placeholder="ABCD EFGH JK23" autoComplete="off" autoCapitalize="characters" spellCheck={false} data-autofocus className={`${CX.input} min-w-0 flex-1 font-mono uppercase tracking-wider`} />
              <ScanCodeButton compact onCode={(scanned) => { setCode(spacedCode(scanned)); setCodeError(""); void check(scanned); }} />
            </div>
            {codeError && <p role="alert" className="mt-2 text-[13px] text-rose-700">{codeError}</p>}
            <p className="mt-2 text-[12.5px] leading-5 text-ink-muted">Press Scan QR code and hold the sticker in front of your camera. The code fills in by itself.</p>
          </div>
          <button type="submit" disabled={!code.trim() || checking} className={`${CX.btnGold} min-h-[48px] w-full px-5`}>{checking ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Checking…</> : "Continue"}</button>
        </form>
      ) : (
        <TagDetailsForm mode="claim" submitLabel="Register this tag" busy={saving} error={formError} onSubmit={(values, consent, photo) => void claim(values, consent, photo)} onCancel={() => setStep("code")} />
      )}
    </Modal>
  );
}
