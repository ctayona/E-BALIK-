import { tr, useT } from "../../utils/preferences";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/** Shared admin UI primitives — "Custody desk" design system. */

export const BTN = {
  primary: "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-navy-900 bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] px-4 text-[14px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_8px_18px_-10px_rgba(17,27,66,0.8)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gold-400/50 dark:bg-[linear-gradient(180deg,#ecc787_0%,#d1a153_100%)] dark:text-navy-950 dark:shadow-[0_0_0_1px_rgba(233,196,124,0.25),0_10px_30px_-8px_rgba(209,161,83,0.65)]",
  gold: "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-gold-600/40 bg-[linear-gradient(180deg,#ecc787_0%,#d1a153_100%)] px-4 text-[14px] font-semibold text-navy-950 shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,0_8px_20px_-12px_rgba(185,135,58,0.9)] transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:shadow-[0_0_0_1px_rgba(233,196,124,0.25),0_10px_30px_-8px_rgba(209,161,83,0.65)]",
  ghost: "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-line-strong bg-[var(--surface)] px-4 text-[14px] font-semibold text-navy-800 transition hover:border-iris-300 hover:bg-frost-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-ink dark:hover:border-white/25 dark:hover:bg-white/[0.07]",
  danger: "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#f43f5e,#e11d48)] px-4 text-[14px] font-semibold text-white shadow-[0_10px_22px_-12px_rgba(225,29,72,0.9)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
  success: "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#2fae8e,#1b7863)] px-4 text-[14px] font-semibold text-white shadow-[0_10px_22px_-12px_rgba(27,120,99,0.9)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
};

export const INPUT = "w-full rounded-xl border border-line-strong bg-[var(--surface)] px-3.5 min-h-[44px] text-[16px] sm:text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-iris-300 focus:border-iris-500 focus:shadow-[0_0_0_4px_rgba(110,142,240,0.18)] disabled:opacity-60 dark:hover:border-white/25 dark:focus:border-gold-400 dark:focus:shadow-[0_0_0_4px_rgba(209,161,83,0.18)]";

/** Page header: title + one-line purpose on the left, the page's primary actions on the right. */
export function PageHeader({ title, description, actions, meta }: { title: string; description?: string; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1 max-w-[68ch] text-[14px] leading-6 text-ink-muted">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Small capsule that tells the admin which role they act with (and why delete is hidden). */
export function RolePill({ superAdmin }: { superAdmin: boolean }) {
  const t = useT();
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ${superAdmin ? "bg-gold-50 text-gold-800 ring-gold-200 dark:ring-gold-500/30" : "bg-frost-100 text-navy-700 ring-line"}`}>
      <span className={`size-1.5 rounded-full ${superAdmin ? "bg-gold-500 shadow-[0_0_8px_rgba(209,161,83,0.9)]" : "bg-navy-400"}`} aria-hidden="true" />
      {superAdmin ? t("role.pillSuper") : t("role.pillAdmin")}
    </span>
  );
}

export function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1 text-[14px] font-semibold text-ink-soft">
        {tr(label)}{required && <span className="text-rose-600" aria-hidden="true">*</span>}
      </label>
      {children(id)}
      {hint && <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">{tr(hint)}</p>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} placeholder={props.placeholder && tr(props.placeholder)} className={`${INPUT} ${props.className ?? ""}`} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${INPUT} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} placeholder={props.placeholder && tr(props.placeholder)} className={`${INPUT} resize-y py-3 leading-6 ${props.className ?? ""}`} />;
}
