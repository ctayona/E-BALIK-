import { LockKeyhole, ShieldOff } from "lucide-react";
import { BTN } from "./ui/primitives";
import { formatDateTime } from "../utils/countdown";
import { tr } from "../utils/preferences";

/** Shown instead of a page this role may not open (Users > Role access). */
export function NoAccessPage({ label, onHome }: { label: string; onHome: () => void }) {
  return (
    <section className="mx-auto mt-10 max-w-[560px] p-4 text-center sm:p-6" role="alert">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-frost-100 text-ink-muted ring-1 ring-line"><ShieldOff size={24} aria-hidden="true" /></span>
      <h2 className="mt-4 font-[family-name:var(--font-heading)] text-[24px] font-semibold text-ink">{tr("No access to {0}", { "0": label })}</h2>
      <p className="mt-2 text-[14.5px] leading-6 text-ink-muted">{tr("Your role cannot open this page. A super administrator can grant it in Users > Role access.")}</p>
      <button type="button" onClick={onHome} className={`${BTN.primary} mt-6`}>{tr("Back to the dashboard")}</button>
    </section>
  );
}

/** Shown instead of a page a super administrator locked while it is being fixed (System control > Page isolation). */
export function LockedPage({ label, message, since, onHome }: { label: string; message: string; since: string | null; onHome: () => void }) {
  return (
    <section className="mx-auto mt-10 max-w-[600px] p-4 sm:p-6" role="alert">
      <div className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(140deg,#22366a_0%,#162448_60%,#0e1830_100%)] p-7 text-white shadow-[0_24px_60px_-34px_rgba(14,24,48,0.9)]">
        <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-60 rounded-full bg-[radial-gradient(circle,rgba(209,161,83,0.35),transparent_68%)]" />
        <span className="relative flex size-14 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950 shadow-[0_0_0_4px_rgba(255,255,255,0.08)]"><LockKeyhole size={24} aria-hidden="true" /></span>
        <h2 className="relative mt-5 font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight">{tr("{0} is temporarily locked", { "0": label })}</h2>
        <p className="relative mt-2 text-[15px] leading-7 text-navy-100">{message || tr("We are fixing something on this page. It opens again as soon as the work is done.")}</p>
        {since && <p className="relative mt-3 text-[13px] text-gold-200">{tr("Locked since {0}", { "0": formatDateTime(since) })}</p>}
      </div>
      <button type="button" onClick={onHome} className={`${BTN.ghost} mt-5`}>{tr("Back to the dashboard")}</button>
    </section>
  );
}

/** A super administrator still sees a locked page (to test the fix); this strip reminds them everyone else is locked out. */
export function LockedForOthersBanner({ label }: { label: string }) {
  return (
    <div className="mx-4 mt-4 flex items-center gap-2.5 rounded-2xl border border-gold-300 bg-gold-50 px-4 py-2.5 text-[13.5px] font-medium text-gold-900 sm:mx-6 dark:border-gold-400/30 dark:bg-gold-500/10 dark:text-gold-200" role="status">
      <LockKeyhole size={16} className="shrink-0" aria-hidden="true" />
      {tr("{0} is locked for everyone except super administrators. Unlock it in System control > Page isolation.", { "0": label })}
    </div>
  );
}
