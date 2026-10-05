import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";

/**
 * Premium modal shell used by every user-app dialog.
 * Desktop: centered glass-framed card. Mobile: bottom sheet with grab handle and safe-area padding.
 * Handles portal, backdrop, focus trap, Escape (topmost modal only), focus restore and scroll lock.
 */
export type ModalTone = "navy" | "gold" | "mint" | "danger" | "iris";

const TONES: Record<ModalTone, string> = {
  navy: "bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300 shadow-[0_10px_24px_-12px_rgba(17,27,66,0.9)]",
  gold: "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950 shadow-[0_10px_24px_-12px_rgba(209,161,83,0.9)]",
  mint: "bg-[linear-gradient(145deg,#9fe0ca,#3fbf9f)] text-white shadow-[0_10px_24px_-12px_rgba(63,191,159,0.9)]",
  danger: "bg-[linear-gradient(145deg,#fda4af,#e11d48)] text-white shadow-[0_10px_24px_-12px_rgba(225,29,72,0.8)]",
  iris: "bg-[linear-gradient(145deg,#c3d0fb,#6e8ef0)] text-white shadow-[0_10px_24px_-12px_rgba(110,142,240,0.9)]",
};

const SIZES = { sm: "sm:max-w-[440px]", md: "sm:max-w-[560px]", lg: "sm:max-w-[720px]", xl: "sm:max-w-[920px]" } as const;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const stack: string[] = [];
let lockCount = 0;
let savedOverflow = "";

function lockScroll() {
  if (lockCount++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}
function unlockScroll() {
  if (--lockCount <= 0) {
    lockCount = 0;
    document.body.style.overflow = savedOverflow;
  }
}

export default function Modal({
  open,
  onClose,
  title,
  eyebrow,
  description,
  icon,
  tone = "navy",
  size = "md",
  footer,
  children,
  dismissible = true,
  hero,
  bodyClassName = "",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: ModalTone;
  size?: keyof typeof SIZES;
  footer?: ReactNode;
  children?: ReactNode;
  /** When false, backdrop clicks and Escape do nothing (use while a request is in flight). */
  dismissible?: boolean;
  /** Full-bleed media rendered above the header (e.g. an item photo). */
  hero?: ReactNode;
  bodyClassName?: string;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  onCloseRef.current = onClose;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(id);
    lockScroll();
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const autofocus = panel.querySelector<HTMLElement>("[data-autofocus]");
      (autofocus || panel.querySelector<HTMLElement>(FOCUSABLE) || panel).focus();
    }, 30);

    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (event.key === "Escape") {
        if (!dismissibleRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey);
      const at = stack.lastIndexOf(id);
      if (at >= 0) stack.splice(at, 1);
      unlockScroll();
      if (restoreRef.current && document.contains(restoreRef.current)) restoreRef.current.focus();
    };
  }, [open, id]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal-backdrop"
          className="fixed inset-0 z-[70] flex items-end justify-center bg-navy-950/60 backdrop-blur-md sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          onMouseDown={(event) => { if (event.target === event.currentTarget && dismissible) onClose(); }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 32, scale: 0.98 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }}
            className={`ui-modal-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/70 bg-white shadow-overlay outline-none sm:max-h-[88dvh] sm:rounded-[26px] ${SIZES[size]}`}
          >
            <span className="absolute left-1/2 top-2 z-10 h-1.5 w-10 -translate-x-1/2 rounded-full bg-slate-300/80 sm:hidden" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(60%_100%_at_15%_0%,rgba(110,142,240,0.14),transparent),radial-gradient(50%_100%_at_100%_0%,rgba(209,161,83,0.14),transparent)]" aria-hidden="true" />

            {hero && <div className="relative shrink-0">{hero}</div>}

            <header className="relative flex shrink-0 items-start gap-4 px-6 pb-4 pt-7 sm:px-7 sm:pt-7">
              {icon && <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${TONES[tone]}`} aria-hidden="true">{icon}</span>}
              <div className="min-w-0 flex-1 pt-0.5">
                {eyebrow && <p className="text-[12px] font-semibold text-gold-700">{eyebrow}</p>}
                <h2 id={titleId} className="mt-0.5 font-[family-name:var(--font-heading)] text-[21px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[23px]">{title}</h2>
                {description && <p id={descId} className="mt-1.5 text-[14px] leading-6 text-ink-muted">{description}</p>}
              </div>
              {dismissible && (
                <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-frost-100 hover:text-ink">
                  <X size={19} aria-hidden="true" />
                </button>
              )}
            </header>

            {children && <div className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 sm:px-7 ${bodyClassName}`}>{children}</div>}

            {footer && (
              <footer className="relative flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-frost-50/80 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:flex-row sm:items-center sm:justify-end sm:px-7 sm:pb-4 [&>*]:w-full sm:[&>*]:w-auto">
                {footer}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Reusable 5-second countdown + acknowledgement block for sensitive confirmations. */
export function CountdownConsent({
  countdown,
  checked,
  onCheckedChange,
  label,
}: {
  countdown: number;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: ReactNode;
}) {
  const progress = Math.max(0, Math.min(1, (5 - countdown) / 5));
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-iris-200 bg-iris-50">
        <div className="flex items-center justify-between px-4 py-3 text-[14px] text-iris-700">
          <span>{countdown > 0 ? "Review carefully, confirmation unlocks shortly" : "You can confirm now"}</span>
          <span className="font-[family-name:var(--font-heading)] text-[16px] font-semibold tabular-nums">{countdown > 0 ? `${countdown}s` : "Ready"}</span>
        </div>
        <div className="h-1 bg-iris-100" aria-hidden="true">
          <div className="h-full bg-iris-500 transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-[14px] leading-6 transition-colors ${checked ? "border-navy-300 bg-navy-50 text-ink" : "border-line bg-white text-ink-soft"} ${countdown > 0 ? "cursor-not-allowed opacity-60" : ""}`}>
        <input type="checkbox" disabled={countdown > 0} checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} className="mt-1 size-[18px] shrink-0 accent-navy-800" />
        <span>{label}</span>
      </label>
    </div>
  );
}
