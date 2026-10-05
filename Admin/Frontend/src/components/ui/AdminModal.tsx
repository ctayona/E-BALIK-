import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { tr } from "../../utils/preferences";
import { trText } from "../../utils/preferences";
/** True when `panel` is the last-opened modal dialog, so Escape only closes the dialog on top. */
export function isTopDialog(panel: HTMLElement | null) {
  const dialogs = document.querySelectorAll('[aria-modal="true"]');
  return Boolean(panel) && dialogs[dialogs.length - 1] === panel;
}

/**
 * Admin dialog shell: centered panel on desktop, bottom sheet on phones.
 * Focus moves inside on open and returns on close; Escape and backdrop close unless `busy`.
 */
export default function AdminModal({
  title,
  description,
  icon,
  tone = "navy",
  size = "md",
  busy = false,
  onClose,
  footer,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: "navy" | "gold" | "mint" | "danger";
  size?: "sm" | "md" | "lg" | "xl";
  busy?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>("input, select, textarea, button")) ?.focus();
    }, 20);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current && isTopDialog(panelRef.current)) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (restore && document.contains(restore)) restore.focus();
    };
  }, []);

  const toneClass = {
    navy: "bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300 dark:shadow-[0_0_0_1px_rgba(209,161,83,0.3),0_8px_24px_-8px_rgba(209,161,83,0.45)]",
    gold: "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950",
    mint: "bg-[linear-gradient(145deg,#9fe0ca,#3fbf9f)] text-white",
    danger: "bg-[linear-gradient(145deg,#fda4af,#e11d48)] text-white",
  }[tone];
  const width = { sm: "sm:max-w-[440px]", md: "sm:max-w-[560px]", lg: "sm:max-w-[760px]", xl: "sm:max-w-[1040px]" }[size];

  return createPortal(
    <div
      className="admin-modal-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-navy-950/60 backdrop-blur-md sm:items-center sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`admin-modal-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/70 bg-white shadow-overlay sm:rounded-[26px] ${width}`}
      >
        <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.85),transparent)] opacity-0 dark:opacity-100" aria-hidden="true" />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(60%_100%_at_15%_0%,rgba(110,142,240,0.12),transparent),radial-gradient(50%_100%_at_100%_0%,rgba(209,161,83,0.12),transparent)]" aria-hidden="true" />
        <header className="relative flex items-start gap-4 border-b border-line px-6 pb-4 pt-6">
          {icon && <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${toneClass}`} aria-hidden="true">{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-[family-name:var(--font-heading)] text-[20px] font-semibold leading-tight text-ink">{trText(title)}</h2>
            {description && <p className="mt-1 text-[14px] leading-6 text-ink-muted">{trText(description)}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={tr("Close")} className="-mr-2 -mt-1 flex size-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-frost-100 hover:text-ink disabled:opacity-40">
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-line bg-frost-50 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:pb-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
