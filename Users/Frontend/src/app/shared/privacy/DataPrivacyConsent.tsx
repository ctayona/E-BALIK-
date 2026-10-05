import { useId, useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";

/**
 * Required Data Privacy Act (RA 10173) consent for forms that collect personal information.
 * The server rejects a submission without it too, so this checkbox is not the only guard.
 */
export default function DataPrivacyConsent({ checked, onChange, disabled = false, purpose }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** What the data is used for in this form, e.g. "process your claim". */
  purpose: string;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className={`rounded-2xl border p-4 transition-colors ${checked ? "border-tide-200 bg-tide-50" : "border-line bg-white"} ${disabled ? "opacity-60" : ""}`}>
      <label className={`flex items-start gap-3 text-[14px] leading-6 text-ink-soft ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          required
          disabled={disabled}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 size-[18px] shrink-0 accent-navy-800"
        />
        <span>
          <span className="flex items-center gap-1.5 font-semibold text-ink"><ShieldCheck size={15} className="text-tide-600" aria-hidden="true" />Data Privacy Act consent <span className="text-rose-600" aria-hidden="true">*</span></span>
          I have read the Data Privacy Notice and I consent to the University of Makati collecting and processing my personal information to {purpose}, in line with the Data Privacy Act of 2012 (RA 10173).
        </span>
      </label>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="mt-2 ml-[30px] inline-flex items-center gap-1 text-[13px] font-semibold text-iris-700 hover:underline"
      >
        {open ? "Hide the notice" : "Read the notice"}<ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={detailsId} className="mt-2 ml-[30px] space-y-1.5 text-[13px] leading-5 text-ink-muted">
          <p><span className="font-semibold text-ink-soft">What we collect:</span> your name, campus ID, email, and the details, photos and documents you submit.</p>
          <p><span className="font-semibold text-ink-soft">Why:</span> to match lost and found items, verify ownership and identity, and contact you about your reports and claims.</p>
          <p><span className="font-semibold text-ink-soft">Who sees it:</span> authorised Lost and Found administrators. Your email and campus ID are never shown publicly. Identity documents are stored privately.</p>
          <p><span className="font-semibold text-ink-soft">Your rights:</span> you may ask to access, correct or delete your data by contacting the Lost and Found Office.</p>
        </div>
      )}
    </div>
  );
}
