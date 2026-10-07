import { useEffect, useId, useState } from "react";
import { BellRing, Megaphone, ShieldCheck } from "lucide-react";
import { authUtils } from "@/app/utils/api";
import { CX } from "@/app/utils/clay";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

type Prefs = { reminders: boolean; announcements: boolean };
const OPTIONS: Array<{ key: keyof Prefs; label: string; hint: string; icon: React.ReactNode }> = [
  { key: "reminders", label: "Reminders", hint: "A nudge a week after a claim is approved, and a heads-up 30 days before a Smart Tag expires.", icon: <BellRing size={18} aria-hidden="true" /> },
  { key: "announcements", label: "Announcements", hint: "Messages the administrators send to everyone, such as office hours or campus notices.", icon: <Megaphone size={18} aria-hidden="true" /> },
];

function Row({ checked, busy, label, hint, icon, onChange }: { checked: boolean; busy: boolean; label: string; hint: string; icon: React.ReactNode; onChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-3.5 transition-colors ${checked ? "border-gold-300 bg-gold-50" : "border-line bg-white"}`}>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${checked ? "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" : "bg-frost-100 text-ink-muted"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-[14.5px] font-semibold text-ink">{label}</label>
        <span className="block text-[12.5px] leading-5 text-ink-muted">{hint}</span>
      </span>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={busy} onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iris-500 disabled:opacity-60 ${checked ? "bg-gold-500" : "bg-slate-300"}`}>
        <span className={`absolute left-0.5 top-0.5 size-6 rounded-full bg-[#ffffff] shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

/** Which optional emails the user gets. Verification codes, claim approvals and other important messages are always sent. */
export default function EmailPreferencesCard() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const token = authUtils.getToken();
    if (!token) return undefined;
    fetch(`${API_URL}/api/email/preferences`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("load failed"))))
      .then((data) => { if (active) { setPrefs(data.preferences as Prefs); setAvailable(data.available !== false); } })
      .catch(() => { if (active) setPrefs(null); });
    return () => { active = false; };
  }, []);

  const change = async (key: keyof Prefs, value: boolean) => {
    if (!prefs || busy) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });   // shown at once, put back if the server says no
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/email/preferences`, {
        method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authUtils.getToken() ?? ""}` }, body: JSON.stringify({ [key]: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Unable to save your choice.");
      setPrefs(data.preferences as Prefs);
    } catch (failure) {
      setPrefs(before);
      showInfoModal({ variant: "error", title: "Choice not saved", message: failure instanceof Error ? failure.message : "Unable to save your choice. Try again." });
    } finally {
      setBusy(false);
    }
  };

  if (!prefs) return null;
  return (
    <section className={`${CX.card} mt-6 p-6 sm:p-7`} aria-labelledby="email-prefs-heading">
      <h2 id="email-prefs-heading" className="font-[family-name:var(--font-heading)] text-[20px] font-semibold text-ink">Email notifications</h2>
      <p className="mt-1 text-[13.5px] leading-6 text-ink-muted">Choose which optional emails you get. Important messages, such as verification codes and claim approvals, are always sent.</p>
      <div className="mt-4 space-y-2.5">
        {OPTIONS.map((option) => (
          <Row key={option.key} checked={prefs[option.key]} busy={busy || !available} label={option.label} hint={option.hint} icon={option.icon} onChange={(value) => void change(option.key, value)} />
        ))}
      </div>
      {!available && <p className="mt-3 text-[12.5px] text-ink-muted" role="status">These choices cannot be saved yet. Please try again later.</p>}
      <p className="mt-4 flex items-center gap-1.5 text-[13px] text-ink-muted"><ShieldCheck size={15} aria-hidden="true" />How we use your data: <a href="/privacy" className="font-semibold text-navy-700 underline underline-offset-2">Data privacy</a></p>
    </section>
  );
}
