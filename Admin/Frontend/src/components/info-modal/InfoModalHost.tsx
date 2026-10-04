import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CheckCircle2, Copy, Info, X, XCircle } from "lucide-react";
import { dismissInfoModal, resolveAutoClose, useInfoModalQueue, type InfoModalVariant } from "./infoModalStore";

const VARIANTS: Record<InfoModalVariant, { label: string; icon: typeof Info; accent: string; soft: string; ring: string; role: "dialog" | "alertdialog" }> = {
  success: { label: "Completed", icon: CheckCircle2, accent: "#0f8a5f", soft: "#e8f7f0", ring: "#bfe8d6", role: "dialog" },
  error: { label: "Action failed", icon: XCircle, accent: "#c2334d", soft: "#fdecef", ring: "#f6c7d0", role: "alertdialog" },
  warning: { label: "Needs attention", icon: AlertTriangle, accent: "#b7791f", soft: "#fdf5e6", ring: "#f3dcae", role: "alertdialog" },
  info: { label: "System message", icon: Info, accent: "#1f3160", soft: "#edf1f9", ring: "#cdd7ec", role: "dialog" },
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Renders the head of the global info-modal queue. Mount exactly once at the app root. Mirrors Users/Frontend/src/app/shared/info-modal. */
export default function InfoModalHost() {
  const queue = useInfoModalQueue();
  const entry = queue[0];
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const elapsedRef = useRef<{ id: number; ms: number }>({ id: 0, ms: 0 });
  const keyboardNavRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const autoCloseMs = entry ? resolveAutoClose(entry) : null;

  const close = useCallback(() => {
    if (entry) dismissInfoModal(entry.id);
  }, [entry]);

  // Remember what had focus before the first modal opened; restore it when the queue empties.
  useEffect(() => {
    if (entry && !restoreFocusRef.current) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (!entry && restoreFocusRef.current) {
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (document.contains(target)) target.focus();
    }
  }, [entry]);

  useEffect(() => {
    if (!entry) return;
    setPaused(false);
    setCopied(false);
    keyboardNavRef.current = false;
    primaryRef.current?.focus();
  }, [entry?.id]);

  // Auto-close countdown; hovering or focusing the dialog pauses it and resumes from the elapsed time.
  useEffect(() => {
    if (!entry || autoCloseMs === null || paused) return;
    const entryId = entry.id;
    const elapsed = elapsedRef.current.id === entryId ? elapsedRef.current.ms : 0;
    const startedAt = Date.now() - elapsed;
    const timer = window.setTimeout(close, Math.max(0, autoCloseMs - elapsed));
    return () => {
      window.clearTimeout(timer);
      elapsedRef.current = { id: entryId, ms: Date.now() - startedAt };
    };
  }, [entry?.id, autoCloseMs, paused, close]);

  useEffect(() => {
    if (!entry) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      keyboardNavRef.current = true;
      setPaused(true);
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [entry, close]);

  if (!entry) return null;

  const variant = VARIANTS[entry.variant];
  const Icon = variant.icon;
  const titleId = `info-modal-title-${entry.id}`;
  const messageId = `info-modal-message-${entry.id}`;

  async function copyReference() {
    if (!entry?.reference) return;
    try {
      await navigator.clipboard.writeText(entry.reference);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-[#0b1530]/55 p-4 backdrop-blur-[6px] sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        key={entry.id}
        ref={dialogRef}
        role={variant.role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={(event) => {
          // The primary button is focused automatically on open; only user-driven focus pauses auto-close.
          if ((event.target as Node) !== primaryRef.current || keyboardNavRef.current) setPaused(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
        }}
        className="info-modal-enter relative w-full max-w-[440px] overflow-hidden rounded-[20px] border border-[#e3e8f1] bg-white shadow-[0_2px_6px_rgba(15,23,42,0.06),0_24px_64px_rgba(11,21,48,0.28)]"
      >
        <div className="flex items-start gap-4 px-6 pb-5 pt-6">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-[14px] border"
            style={{ background: variant.soft, color: variant.accent, borderColor: variant.ring }}
          >
            <Icon size={24} strokeWidth={2.2} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: variant.accent }}>
                {variant.label}
              </span>
              {queue.length > 1 && (
                <span className="rounded-full bg-[#f1f4f9] px-2 py-0.5 text-[10px] font-semibold text-[#64748b]">1 of {queue.length}</span>
              )}
            </div>
            <h2 id={titleId} className="mt-1 text-[19px] font-bold leading-snug text-[#0f172a]" style={{ fontFamily: "var(--font-heading, inherit)" }}>
              {entry.title}
            </h2>
            <p id={messageId} className="mt-2 whitespace-pre-line break-words text-[14px] leading-6 text-[#475569]">
              {entry.message}
            </p>
            {entry.details && entry.details.length > 0 && (
              <ul className="mt-3 space-y-1.5 rounded-xl bg-[#f8fafc] px-4 py-3 text-[13px] leading-5 text-[#475569]">
                {entry.details.map((detail) => (
                  <li key={detail} className="flex gap-2">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: variant.accent }} aria-hidden="true" />
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {entry.reference && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#e3e8f1] bg-[#f8fafc] py-2 pl-4 pr-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#94a3b8]">Reference</div>
                  <div className="truncate font-mono text-[15px] font-semibold text-[#1f3160]">{entry.reference}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyReference()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-[#1f3160] transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d1a153]"
                >
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close message"
            className="-mr-2 -mt-2 rounded-lg p-2 text-[#94a3b8] transition hover:bg-[#f1f4f9] hover:text-[#334155] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d1a153]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[#eef1f6] bg-[#fafbfd] px-6 py-4">
          <span className="text-[12px] text-[#94a3b8]">{autoCloseMs === null ? "Press Esc to close" : paused ? "Paused" : "Closes automatically"}</span>
          <button
            ref={primaryRef}
            type="button"
            onClick={close}
            className="min-w-[112px] rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d1a153]"
            style={{ background: entry.variant === "info" ? "#1f3160" : variant.accent }}
          >
            {entry.actionLabel || (entry.variant === "error" ? "Got it" : "Continue")}
          </button>
        </div>
        {autoCloseMs !== null && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[#eef1f6]" aria-hidden="true">
            <div
              className="info-modal-progress h-full origin-left"
              style={{ background: variant.accent, animationDuration: `${autoCloseMs}ms`, animationPlayState: paused ? "paused" : "running" }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
