import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { fetchDigestPreference, saveDigestPreference } from "../../utils/api";
import { tr } from "../../utils/preferences";

/** Turns the morning summary email (what is waiting for a decision) on or off for the signed-in administrator. */
export default function DailySummaryCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchDigestPreference()
      .then((result) => { if (active) { setEnabled(result.enabled); setAvailable(result.available); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : tr("Unable to load your email choices.")); });
    return () => { active = false; };
  }, []);

  const toggle = async () => {
    if (enabled === null || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const next = await saveDigestPreference(!enabled);
      setEnabled(next);
      setMessage(next ? tr("You will get the daily summary again.") : tr("The daily summary is off. You can turn it back on here."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("Unable to save your email choice."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto mt-6 max-w-4xl rounded-2xl border border-line bg-white p-6 shadow-sm" aria-labelledby="daily-summary-heading">
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-frost-100 text-iris-600" aria-hidden="true"><MailCheck size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="daily-summary-heading" className="text-lg font-bold text-slate-900">{tr("Daily summary email")}</h2>
          <p className="mt-1 max-w-[64ch] text-sm leading-6 text-slate-600">{tr("Each morning (Makati time) E-Balik emails you what is waiting: claims to review, results to confirm, approved claims close to expiring and items a guard has not confirmed. Nothing is sent on days when nothing is waiting.")}</p>
          {!available && <p className="mt-2 text-sm text-gold-800">{tr("This switch works after the latest database update.")}</p>}
          {message && <p role="status" className="mt-2 text-sm font-medium text-mint-700">{message}</p>}
          {error && <p role="alert" className="mt-2 text-sm font-medium text-rose-700">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(enabled)}
          aria-label={tr("Daily summary email")}
          disabled={enabled === null || busy || !available}
          onClick={toggle}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${enabled ? "bg-navy-800" : "bg-slate-300"}`}
        >
          <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
    </section>
  );
}
