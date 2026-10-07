import { useState } from "react";
import { UserX } from "lucide-react";
import AdminModal from "./ui/AdminModal";
import { BTN, INPUT } from "./ui/primitives";
import { updateAdminUserStatus } from "../utils/api";
import { tr } from "../utils/preferences";

const DURATIONS: { days: number | null; label: string }[] = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
  { days: null, label: "Until reactivated" },
];

/** Suspend an account for a set time (or until an admin lifts it). Used by the Users page and the auction quick action. */
export default function SuspendUserModal({ accountId, name, defaultReason = "", defaultDays = 7, onClose, onDone }: {
  accountId: string;
  name: string;
  defaultReason?: string;
  defaultDays?: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [days, setDays] = useState<number | null>(defaultDays);
  const [reason, setReason] = useState(defaultReason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await updateAdminUserStatus(accountId, "suspended", { days, reason: reason.trim() });
      onDone();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to suspend this account."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminModal
      title={tr("Suspend {0}?", { "0": name })}
      description={tr("They are signed out and cannot sign in, report, claim or bid until the suspension ends.")}
      icon={<UserX size={19} />}
      tone="danger"
      size="sm"
      busy={busy}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={BTN.danger}>{busy ? tr("Working…") : tr("Suspend account")}</button>
      </>}
    >
      <fieldset>
        <legend className="mb-2 text-[14px] font-semibold text-ink-soft">{tr("How long?")}</legend>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((option) => {
            const active = option.days === days;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={active}
                onClick={() => setDays(option.days)}
                className={`min-h-[40px] rounded-xl border px-3.5 text-[13.5px] font-semibold transition ${active ? "border-rose-400 bg-rose-50 text-rose-800 shadow-[0_8px_20px_-14px_rgba(225,29,72,0.9)] dark:bg-rose-500/15 dark:text-[#fecdd3]" : "border-line-strong bg-[var(--surface)] text-ink-soft hover:border-iris-300"}`}
              >
                {tr(option.label)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-ink-muted">{days ? tr("The account is reactivated automatically on {0}.", { "0": new Date(Date.now() + days * 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) }) : tr("The account stays suspended until you reactivate it.")}</p>
      </fieldset>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Reason (the user sees this)")}</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={300} placeholder={tr("Did not collect an auction item.")} className={`${INPUT} resize-y py-3 leading-6`} />
      </label>
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{error}</p>}
    </AdminModal>
  );
}
