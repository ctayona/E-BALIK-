import type { ReactNode } from "react";
import { Database } from "lucide-react";
import { tr } from "../../utils/preferences";

/** The glass card every System Control tool sits in. */
export function Card({ icon, tone = "navy", title, description, children, aside }: {
  icon: ReactNode;
  tone?: "navy" | "danger" | "gold" | "mint";
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  const badge = {
    navy: "bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300",
    danger: "bg-[linear-gradient(145deg,#fda4af,#e11d48)] text-white",
    gold: "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950",
    mint: "bg-[linear-gradient(145deg,#9fe0ca,#3fbf9f)] text-white",
  }[tone];
  return (
    <section className="glass-panel flex min-w-0 flex-col p-5 sm:p-6">
      <header className="mb-4 flex flex-wrap items-start gap-3.5 sm:flex-nowrap">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${badge}`} aria-hidden="true">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-[family-name:var(--font-heading)] text-[18px] font-semibold leading-tight text-ink">{title}</h2>
          <p className="mt-1 text-[13.5px] leading-5 text-ink-muted">{description}</p>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">{children}</p>;
}

/** Shown when a tool needs the 20261010 migration. The tool is hidden behind it rather than failing with an error. */
export function MigrationNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-gold-300/60 bg-gold-50 p-4 dark:border-gold-500/30 dark:bg-gold-500/10" role="alert">
      <Database size={19} className="mt-0.5 shrink-0 text-gold-700 dark:text-gold-300" aria-hidden="true" />
      <div className="min-w-0 text-[14px] leading-6 text-ink-soft">
        <p className="font-semibold text-ink">{tr("This tool needs one database step")}</p>
        <p>{tr("Run Server/manual_migrations/20261010_tag_photo_and_mission_control.sql in the Supabase SQL Editor, then reload this page.")}</p>
        <p className="mt-1 text-[12.5px] text-ink-muted">{message}</p>
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled, tone = "gold" }: { on: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean; tone?: "gold" | "rose" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-iris-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${on ? (tone === "rose" ? "border-rose-500 bg-rose-500" : "border-gold-500 bg-gold-500") : "border-line-strong bg-white dark:bg-white/10"}`}
    >
      <span className={`absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow-md transition-transform duration-200 ${on ? "translate-x-6" : ""}`} />
    </button>
  );
}
