import { useEffect, useState } from "react";
import { CheckCircle2, Megaphone, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { fetchPublicSystemStatus } from "../utils/systemApi";
import type { AnnouncementTone } from "../utils/missionApi";

export interface LiveAnnouncement { id: string; tone: AnnouncementTone; title: string; message: string }

const LOOK: Record<AnnouncementTone, { surface: string; icon: typeof Megaphone }> = {
  info: { surface: "bg-[linear-gradient(90deg,#1f3160_0%,#2b4282_55%,#3a58a8_100%)] text-white", icon: Megaphone },
  success: { surface: "bg-[linear-gradient(90deg,#0f5d4b_0%,#1b7863_60%,#25957c_100%)] text-white", icon: CheckCircle2 },
  warning: { surface: "bg-[linear-gradient(90deg,#e6be76_0%,#d1a153_60%,#c28f3f_100%)] text-[#0e1830]", icon: TriangleAlert },
  critical: { surface: "bg-[linear-gradient(90deg,#9f1239_0%,#c81e4a_60%,#e11d48_100%)] text-white", icon: ShieldAlert },
};

/** The banner itself. Also used as the live preview in System Control, so what an admin sees is exactly what everyone gets. */
export function BannerView({ note, onDismiss, preview = false }: { note: Omit<LiveAnnouncement, "id">; onDismiss?: () => void; preview?: boolean }) {
  const look = LOOK[note.tone] ?? LOOK.info;
  const Icon = look.icon;
  return (
    <aside
      role={preview ? undefined : note.tone === "critical" || note.tone === "warning" ? "alert" : "status"}
      className={`admin-banner-in relative overflow-hidden border-b border-white/20 shadow-[0_10px_30px_-14px_rgba(5,10,30,0.7)] ${look.surface} ${preview ? "rounded-2xl border" : ""}`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.7),transparent)]" aria-hidden="true" />
      <div className="flex items-start gap-3 px-4 py-2.5 pr-3 sm:items-center sm:px-5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur sm:mt-0" aria-hidden="true"><Icon size={17} /></span>
        <p className="min-w-0 flex-1 text-[14px] leading-6">
          {note.title && <strong className="mr-2 font-semibold">{note.title}</strong>}
          <span className="break-words opacity-95">{note.message}</span>
        </p>
        {onDismiss && note.tone !== "critical" && (
          <button type="button" aria-label="Dismiss this announcement" onClick={onDismiss} className="flex size-9 shrink-0 items-center justify-center rounded-lg opacity-80 transition hover:bg-black/10 hover:opacity-100 active:scale-90">
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>
    </aside>
  );
}

const key = (id: string) => `ebalik_admin_banner_dismissed:${id}`;
const dismissedBefore = (id: string) => { try { return sessionStorage.getItem(key(id)) === "1"; } catch { return false; } };

/** Campus announcement shown above every admin page. Polled every 30 seconds; closing it lasts for this visit only. */
export default function AnnouncementBanner() {
  const [note, setNote] = useState<LiveAnnouncement | null>(null);
  const [closed, setClosed] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (document.hidden) return;
      fetchPublicSystemStatus().then((status) => {
        if (!active) return;
        const next = status.announcement;
        setNote(next && next.message ? { id: String(next.id || next.message), tone: next.tone, title: next.title || "", message: next.message } : null);
      }).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (!note || closed.includes(note.id) || dismissedBefore(note.id)) return null;
  return <BannerView note={note} onDismiss={() => { setClosed((list) => [...list, note.id]); try { sessionStorage.setItem(key(note.id), "1"); } catch { /* it returns on reload */ } }} />;
}
