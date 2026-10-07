import { useEffect, useState } from "react";
import { Megaphone, Radio, Save } from "lucide-react";
import { BannerView } from "../../components/AnnouncementBanner";
import { BTN, INPUT } from "../../components/ui/primitives";
import { saveAnnouncement, type Announcement, type AnnouncementTone } from "../../utils/missionApi";
import { formatDateTime } from "../../utils/countdown";
import { tr } from "../../utils/preferences";
import { Card, Toggle } from "./parts";

const TONES: { value: AnnouncementTone; label: string; hint: string; swatch: string }[] = [
  { value: "info", label: "Announcement", hint: "General news", swatch: "bg-[linear-gradient(135deg,#1f3160,#3a58a8)]" },
  { value: "success", label: "Good news", hint: "Something to celebrate", swatch: "bg-[linear-gradient(135deg,#0f5d4b,#25957c)]" },
  { value: "warning", label: "Heads up", hint: "Planned downtime", swatch: "bg-[linear-gradient(135deg,#e6be76,#c28f3f)]" },
  { value: "critical", label: "Important", hint: "Urgent, cannot be closed", swatch: "bg-[linear-gradient(135deg,#9f1239,#e11d48)]" },
];

/** Write a campus-wide banner, preview it exactly as users will see it, and switch it live or off. */
export default function AnnouncementPanel({ current, onSaved }: { current: Announcement | null; onSaved: () => void }) {
  const [live, setLive] = useState(Boolean(current?.live));
  const [tone, setTone] = useState<AnnouncementTone>(current?.tone ?? "info");
  const [title, setTitle] = useState(current?.title ?? "");
  const [message, setMessage] = useState(current?.message ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!current) return;
    setLive(Boolean(current.live));
    setTone(current.tone ?? "info");
    setTitle(current.title ?? "");
    setMessage(current.message ?? "");
  }, [current?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps -- only refill the form when a save changed it

  const ready = !live || message.trim().length >= 3;
  const dirty = !current || current.live !== live || current.tone !== tone || (current.title ?? "") !== title.trim() || (current.message ?? "") !== message.trim();

  const save = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      await saveAnnouncement({ live, tone, title: title.trim(), message: message.trim() });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to save the announcement."));
    } finally {
      setBusy(false);
    }
  };

  const showing = Boolean(current?.live);

  return (
    <Card
      icon={<Megaphone size={21} />}
      tone={showing ? "gold" : "navy"}
      title={tr("Global announcement banner")}
      description={tr("A banner across the top of every user and admin page, for campus news or planned downtime. Users can close it for their visit, except an Important one.")}
      aside={showing ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e6f7f1] px-3 py-1 text-[12.5px] font-semibold text-[#14594a] ring-1 ring-[#bfe8db] dark:bg-[#3fbf9f]/10 dark:text-[#9fe0ca] dark:ring-[#3fbf9f]/30"><Radio size={13} className="animate-pulse" aria-hidden="true" />{tr("Live now")}</span> : undefined}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Title (optional)")}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder={tr("Scheduled maintenance")} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Message")}</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={400} placeholder={tr("E-Balik will be offline on Saturday from 10 PM to 12 AM while we upgrade.")} className={`${INPUT} resize-y py-3 leading-6`} />
            <span className="mt-1 flex justify-between text-[12.5px] text-ink-muted"><span>{tr("Plain text only.")}</span><span className="tabular-nums">{message.length}/400</span></span>
          </label>
          <fieldset>
            <legend className="mb-1.5 text-[14px] font-semibold text-ink-soft">{tr("Style")}</legend>
            <div className="grid grid-cols-2 gap-2">
              {TONES.map((option) => (
                <button key={option.value} type="button" aria-pressed={tone === option.value} onClick={() => setTone(option.value)}
                  className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${tone === option.value ? "border-gold-500 bg-gold-50 shadow-[0_0_0_3px_rgba(209,161,83,0.2)] dark:bg-gold-500/10" : "border-line-strong hover:border-iris-300"}`}>
                  <span className={`size-8 shrink-0 rounded-lg ring-1 ring-black/10 ${option.swatch}`} aria-hidden="true" />
                  <span className="min-w-0"><span className="block truncate text-[13.5px] font-semibold text-ink">{tr(option.label)}</span><span className="block truncate text-[12px] text-ink-muted">{tr(option.hint)}</span></span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <p className="mb-1.5 text-[14px] font-semibold text-ink-soft">{tr("Preview")}</p>
            <div className="rounded-2xl border border-dashed border-line-strong bg-frost-50 p-3">
              {message.trim() ? <BannerView preview note={{ tone, title: title.trim(), message: message.trim() }} /> : <p className="px-2 py-6 text-center text-[13.5px] text-ink-muted">{tr("Type a message to see the banner.")}</p>}
            </div>
          </div>
          <div className={`flex items-center gap-4 rounded-2xl border p-4 transition-colors ${live ? "border-gold-400/70 bg-gold-50/60 dark:bg-gold-500/10" : "border-line bg-frost-50"}`}>
            <Toggle on={live} onChange={setLive} label={tr("Show the banner to everyone")} />
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">{live ? tr("Will be live on every page") : tr("Hidden")}</p>
              <p className="text-[13px] text-ink-muted">{current?.updated_at ? tr("Last saved {0}", { "0": formatDateTime(current.updated_at) }) : tr("Nothing saved yet.")}</p>
            </div>
          </div>
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-[#fecdd3]">{error}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void save()} disabled={busy || !ready || !dirty} className={live ? BTN.gold : BTN.primary}><Save size={16} aria-hidden="true" />{busy ? tr("Saving…") : live ? tr("Save and go live") : tr("Save")}</button>
            {!ready && <span className="text-[13px] text-rose-700 dark:text-rose-300">{tr("Write the message before going live.")}</span>}
          </div>
        </div>
      </div>
    </Card>
  );
}
