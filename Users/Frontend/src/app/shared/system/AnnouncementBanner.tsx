import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Info, Megaphone, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { useAnnouncement, type AnnouncementTone } from "@/app/utils/system";

const TONES: Record<AnnouncementTone, { surface: string; icon: typeof Info; label: string }> = {
  info: { surface: "bg-[linear-gradient(90deg,#1f3160_0%,#2b4282_55%,#3a58a8_100%)] text-white", icon: Megaphone, label: "Announcement" },
  success: { surface: "bg-[linear-gradient(90deg,#0f5d4b_0%,#1b7863_60%,#25957c_100%)] text-white", icon: CheckCircle2, label: "Good news" },
  warning: { surface: "bg-[linear-gradient(90deg,#e6be76_0%,#d1a153_60%,#c28f3f_100%)] text-navy-950", icon: TriangleAlert, label: "Heads up" },
  critical: { surface: "bg-[linear-gradient(90deg,#9f1239_0%,#c81e4a_60%,#e11d48_100%)] text-white", icon: ShieldAlert, label: "Important" },
};

const dismissedKey = (id: string) => `ebalik_banner_dismissed:${id}`;
const wasDismissed = (id: string) => { try { return sessionStorage.getItem(dismissedKey(id)) === "1"; } catch { return false; } };

/**
 * The campus-wide announcement a super admin switches on in System Control. It sits at the very top of every page.
 * The text is plain and rendered as React text. A visitor may close it for this visit; a "critical" notice cannot be closed.
 */
export default function AnnouncementBanner() {
  const note = useAnnouncement();
  const reduced = useReducedMotion();
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = Boolean(note) && !hidden.includes(note!.id) && !wasDismissed(note!.id);
  const tone = TONES[note?.tone ?? "info"];
  const Icon = tone.icon;

  return (
    <AnimatePresence initial={false}>
      {visible && note && (
        <motion.aside
          key={note.id}
          role={note.tone === "critical" || note.tone === "warning" ? "alert" : "status"}
          aria-label={tone.label}
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
          className={`relative z-[45] overflow-hidden border-b border-white/20 shadow-[0_10px_30px_-14px_rgba(5,10,30,0.7)] ${tone.surface}`}
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.7),transparent)]" aria-hidden="true" />
          <div className="mx-auto flex w-full max-w-[1440px] items-start gap-3 px-4 py-2.5 pr-3 sm:items-center sm:px-6">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur sm:mt-0" aria-hidden="true"><Icon size={17} /></span>
            <p className="min-w-0 flex-1 text-[14px] leading-6 sm:text-[14.5px]">
              {note.title && <strong className="mr-2 font-semibold">{note.title}</strong>}
              <span className="break-words opacity-95">{note.message}</span>
            </p>
            {note.tone !== "critical" && (
              <button
                type="button"
                aria-label="Dismiss this announcement"
                onClick={() => { setHidden((list) => [...list, note.id]); try { sessionStorage.setItem(dismissedKey(note.id), "1"); } catch { /* private mode: it just returns on reload */ } }}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg opacity-80 transition hover:bg-black/10 hover:opacity-100 active:scale-90"
              >
                <X size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
