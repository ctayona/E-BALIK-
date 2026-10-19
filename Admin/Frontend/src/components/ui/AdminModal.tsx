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
  const glow = {
    navy: "bg-[radial-gradient(70%_120%_at_0%_0%,rgba(110,142,240,0.16),transparent_70%),radial-gradient(55%_120%_at_100%_0%,rgba(209,161,83,0.16),transparent_70%)]",
    gold: "bg-[radial-gradient(80%_130%_at_0%_0%,rgba(209,161,83,0.22),transparent_70%),radial-gradient(50%_120%_at_100%_0%,rgba(110,142,240,0.1),transparent_70%)]",
    mint: "bg-[radial-gradient(80%_130%_at_0%_0%,rgba(63,191,159,0.2),transparent_70%),radial-gradient(50%_120%_at_100%_0%,rgba(209,161,83,0.1),transparent_70%)]",
    danger: "bg-[radial-gradient(80%_130%_at_0%_0%,rgba(225,29,72,0.14),transparent_70%)]",
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
        <span className="absolute left-1/2 top-2 z-10 h-1.5 w-10 -translate-x-1/2 rounded-full bg-slate-300/80 sm:hidden" aria-hidden="true" />
        <span className={`pointer-events-none absolute inset-x-0 top-0 h-36 ${glow}`} aria-hidden="true" />
        <header className="ui-modal-header ui-modal-header--ruled relative flex items-start gap-4 px-6 pb-5 pt-7 sm:px-7">
          {icon && <span className={`ui-modal-icon flex size-12 shrink-0 items-center justify-center rounded-2xl ${toneClass}`} aria-hidden="true">{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="pt-0.5 font-[family-name:var(--font-heading)] text-[21px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[22px]">{trText(title)}</h2>
            {description && <p className="mt-1 text-[14px] leading-6 text-ink-muted">{trText(description)}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={tr("Close")} className="ui-modal-close -mr-1 -mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white/80 text-ink-muted shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-line-strong hover:bg-frost-100 hover:text-ink disabled:opacity-40">
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 sm:px-7">{children}</div>
        {footer && (
          <footer className="ui-modal-footer relative flex flex-col-reverse gap-2 border-t border-line bg-frost-50/80 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:flex-row sm:items-center sm:justify-end sm:gap-2.5 sm:px-7 sm:pb-4 [&>*]:min-h-[46px]">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
