import { useState } from "react";
import { ClipboardPen, FilePlus2 } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, Field, TextArea, TextInput } from "../../components/ui/primitives";
import { createAdminClaim, updateAdminClaimDetails } from "../../utils/api";

import { tr } from "../../utils/preferences";
const MAX_REASON = 2000;

type Props =
  | { mode: "create"; onClose: () => void; onSaved: () => void }
  | { mode: "edit"; claimId: string; claimReference?: string; currentReason?: string; onClose: () => void; onSaved: () => void };

/** Record a walk-in claim for a registered claimant, or edit the reason on an open claim. */
export default function ClaimFormModal(props: Props) {
  const editing = props.mode === "edit";
  const [reference, setReference] = useState("");
  const [claimant, setClaimant] = useState("");
  const [reason, setReason] = useState(editing ? props.currentReason ?? "" : "");
  const [verifiedInPerson, setVerifiedInPerson] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (props.mode === "edit") await updateAdminClaimDetails(props.claimId, reason.trim());
      else await createAdminClaim({ found_item_reference: reference.trim().toUpperCase(), claimant: claimant.trim(), claim_reason: reason.trim(), verified_in_person: verifiedInPerson });
      props.onSaved();
      props.onClose();
    } catch {
      // The API helper already reported the server's reason through the global result modal.
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminModal
      title={editing ? tr("Edit claim reason") : tr("Record a walk-in claim")}
      description={editing
        ? tr("Update the claimant's stated reason for {0}. Status changes stay in the review dialog.", { "0": props.mode === "edit" && props.claimReference ? props.claimReference : tr("this claim") })
        : tr("For claimants who come to the Lost and Found Office in person. The claim joins the review queue as pending, and the claimant is notified.")}
      icon={editing ? <ClipboardPen size={20} /> : <FilePlus2 size={20} />}
      tone={editing ? "navy" : "gold"}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" onClick={props.onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
          <button type="submit" form="admin-claim-form" disabled={busy || !reason.trim()} className={editing ? BTN.primary : BTN.gold}>
            {busy ? tr("Saving…") : editing ? tr("Save reason") : tr("Record claim")}
          </button>
        </>
      }
    >
      <form id="admin-claim-form" onSubmit={submit} className="grid gap-4">
        {!editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Found item reference")} required hint={tr("The FP… reference on the item's tag.")}>
              {(id) => <TextInput id={id} data-autofocus value={reference} onChange={(e) => setReference(e.target.value)} required placeholder={tr("FP1023")} autoComplete="off" autoCapitalize="characters" />}
            </Field>
            <Field label={tr("Claimant email or campus ID")} required hint={tr("Must be a registered, active account.")}>
              {(id) => <TextInput id={id} value={claimant} onChange={(e) => setClaimant(e.target.value)} required placeholder={tr("K12345678")} autoComplete="off" />}
            </Field>
          </div>
        )}
        <Field label={tr("Why the claimant says it's theirs")} required hint={`${reason.length}/${MAX_REASON} characters`}>
          {(id) => <TextArea id={id} data-autofocus={editing ? true : undefined} value={reason} onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))} required rows={5} placeholder={tr("Describes the sticker on the lid and the initials engraved underneath.")} />}
        </Field>
        {!editing && (
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-[14px] leading-6 transition-colors ${verifiedInPerson ? "border-tide-200 bg-tide-50 text-ink" : "border-line bg-frost-50 text-ink-soft"}`}>
            <input type="checkbox" checked={verifiedInPerson} onChange={(e) => setVerifiedInPerson(e.target.checked)} className="mt-1 size-[18px] shrink-0 accent-navy-800" />
            {tr("I checked the claimant's ID in person. (Recorded on the claim in place of an uploaded document.)")}
          </label>
        )}
      </form>
    </AdminModal>
  );
}
