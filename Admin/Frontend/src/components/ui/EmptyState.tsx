import type { ReactNode } from "react";

/** The one "nothing here yet" panel: say what is missing and what to do about it. Used wherever a list or section can be empty. */
export default function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong bg-frost-50/60 px-6 py-8 text-center dark:bg-white/[0.03]" role="status">
      {icon && <span className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-[var(--surface)] text-navy-700 shadow-sm dark:text-gold-300" aria-hidden="true">{icon}</span>}
      <p className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">{title}</p>
      {children && <p className="max-w-[46ch] text-[13.5px] leading-5 text-ink-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
