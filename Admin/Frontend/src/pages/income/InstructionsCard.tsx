import { useEffect, useState } from "react";
import { Megaphone, Save } from "lucide-react";
import { BTN, INPUT } from "../../components/ui/primitives";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { canDelete } from "../../utils/permissions";
import { fetchInstructions, saveInstructions } from "../../utils/incomeApi";
import { tr } from "../../utils/preferences";

/** What payers are told on their auction win and Smart Tag: where to pay, the GCash number, the office hours. Super admins edit it; everyone can read it. */
export default function InstructionsCard() {
  const superAdmin = canDelete();
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchInstructions().then((value) => { setSaved(value); setText(value); }).catch(() => setSaved("")); }, []);
  if (saved === null) return null;
  const changed = text.trim() !== saved.trim();
  const save = async () => {
    setBusy(true);
    try { const value = await saveInstructions(text); setSaved(value); setText(value); } catch (failure) { showInfoModal({ variant: "error", title: tr("Not saved"), message: failure instanceof Error ? failure.message : tr("Unable to save the instructions.") }); } finally { setBusy(false); }
  };
  return (
    <details className="glass-panel group p-4 sm:p-5" open={!saved}>
      <summary className="flex cursor-pointer list-none items-center gap-3 text-[15px] font-semibold text-ink">
        <span className="flex size-9 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><Megaphone size={17} /></span>
        {tr("What payers are told")}
        <span className="ml-auto text-[12.5px] font-normal text-ink-muted">{saved ? tr("Shown on their auction win and Smart Tag") : tr("Not set yet")}</span>
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-[13px] leading-5 text-ink-muted">{tr("Say where and how to pay: the office and its hours, and the GCash, Maya or bank account number and name. Payers then send their payment receipt from the app.")}</p>
        <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={800} rows={4} readOnly={!superAdmin} className={`${INPUT} py-2.5`} placeholder={tr("Pay at the Lost and Found Office (Mon to Fri, 8 AM to 5 PM) or by GCash to 0917 000 0000 (UMak Lost and Found). Then send your receipt here.")} />
        {superAdmin ? (
          <div className="flex items-center justify-between gap-3"><span className="text-[12.5px] text-ink-muted">{text.length}/800</span>
            <button type="button" onClick={() => void save()} disabled={!changed || busy} className={BTN.primary}><Save size={16} aria-hidden="true" />{busy ? tr("Saving…") : tr("Save instructions")}</button></div>
        ) : <p className="text-[12.5px] text-ink-muted">{tr("Only a super administrator can change this text.")}</p>}
      </div>
    </details>
  );
}
