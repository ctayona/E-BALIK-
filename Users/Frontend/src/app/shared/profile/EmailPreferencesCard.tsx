import { useEffect, useState } from "react";
import { BellRing, Megaphone } from "lucide-react";
import { authUtils } from "@/app/utils/api";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { SwitchRow } from "@/app/shared/tags/SmartTagContactModal";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

type Prefs = { reminders: boolean; announcements: boolean };
const OPTIONS: Array<{ key: keyof Prefs; label: string; hint: string; icon: React.ReactNode }> = [
  { key: "reminders", label: "Reminder emails", hint: "A nudge a week after a claim is approved, and a heads-up 30 days before a Smart Tag expires.", icon: <BellRing size={18} aria-hidden="true" /> },
  { key: "announcements", label: "Announcement emails", hint: "Messages the administrators send to everyone, such as office hours or campus notices.", icon: <Megaphone size={18} aria-hidden="true" /> },
];

/**
 * Which optional emails this account gets (saved on the server, so it follows the person to every device). Verification codes,
 * claim approvals and other important messages are always sent. Shown in Settings > Notifications.
 */
export default function EmailPreferenceRows() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [available, setAvailable] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const token = authUtils.getToken();
    if (!token) return undefined;
    fetch(`${API_URL}/api/email/preferences`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("load failed"))))
      .then((data) => { if (active) { setPrefs(data.preferences as Prefs); setAvailable(data.available !== false); } })
      .catch(() => { if (active) setFailed(true); });
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

  if (failed) return <p className="rounded-2xl border border-dashed border-line-strong px-4 py-3 text-[13px] text-ink-muted" role="status">Email choices could not be loaded. Check your connection and open Settings again.</p>;
  if (!prefs) return <div className="h-[132px] animate-pulse rounded-2xl bg-frost-100" aria-busy="true" aria-label="Loading email choices" />;
  return (
    <div className="space-y-2.5">
      {OPTIONS.map((option) => (
        <SwitchRow key={option.key} checked={prefs[option.key]} onChange={(value) => { if (available && !busy) void change(option.key, value); }} label={option.label} hint={option.hint} icon={option.icon} />
      ))}
      {!available && <p className="text-[12.5px] text-ink-muted" role="status">These choices cannot be saved yet. Please try again later.</p>}
    </div>
  );
}
