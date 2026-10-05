import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { BTN, INPUT } from "./ui/primitives";
import { isTopDialog } from "./ui/AdminModal";

import { tr } from "../utils/preferences";
interface ConfirmActionDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  requireAuthenticatorCode?: boolean;
  onCancel: () => void;
  onConfirm: (authenticatorCode?: string) => void;
}

/** Premium confirmation dialog for sensitive admin actions (type CONFIRM, optional authenticator code). */
export default function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  busy = false,
  requireAuthenticatorCode = false,
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [typed, setTyped] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const [authenticatorCode, setAuthenticatorCode] = useState("");
  // Callers pass a short action phrase ("delete lost report MP1021"); show it as one question.
  const phrase = tr(title.trim());
  const heading = `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}${phrase.endsWith("?") ? "" : "?"}`;
  const ready = typed === "CONFIRM" && (!requireAuthenticatorCode || authenticatorCode.length === 6) && !busy;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy && isTopDialog(panelRef.current)) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onCancel]);

  const inputClass = INPUT;

  // Portaled above AdminModal (z-70) so a confirmation always sits on top of the form that opened it.
  return createPortal(
    <div
      className="admin-modal-backdrop fixed inset-0 z-[90] flex items-end justify-center bg-navy-950/60 backdrop-blur-md sm:items-center sm:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}
    >
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="confirm-action-title" aria-describedby="confirm-action-desc" className="admin-modal-panel relative w-full overflow-hidden rounded-t-[28px] border border-white/70 bg-white shadow-overlay sm:max-w-md sm:rounded-[26px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(60%_100%_at_15%_0%,rgba(110,142,240,0.14),transparent),radial-gradient(50%_100%_at_100%_0%,rgba(209,161,83,0.14),transparent)]" aria-hidden="true" />
        <div className="relative p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-7">
          <div className="mb-4 flex items-start gap-4">
            <span
              className={`flex size-12 shrink-0 items-center justify-center rounded-2xl text-white ${
                danger ? "bg-[linear-gradient(145deg,#fda4af,#e11d48)] shadow-[0_10px_24px_-12px_rgba(225,29,72,0.8)]" : "bg-[linear-gradient(145deg,#2b4282,#1f3160)] shadow-[0_10px_24px_-12px_rgba(17,27,66,0.9)]"
              }`}
              aria-hidden="true"
            >
              {danger ? <AlertTriangle size={21} /> : <ShieldCheck size={21} />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`text-[13px] font-semibold ${danger ? "text-rose-700" : "text-gold-700"}`}>{tr("Confirmation required")}</p>
              <h2 id="confirm-action-title" className="mt-0.5 font-[family-name:var(--font-heading)] text-[20px] font-semibold leading-tight text-ink">{heading}</h2>
            </div>
          </div>

          <p id="confirm-action-desc" className="mb-5 text-[14px] leading-6 text-ink-muted">{tr(description)} {tr("Double-check this action before continuing.")}</p>

          <label htmlFor="confirm-action-input" className="mb-1.5 block text-[13px] font-semibold text-ink-soft">{tr("Type CONFIRM to continue")}</label>
          <input
            id="confirm-action-input"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={tr("CONFIRM")}
            className={`${inputClass} text-center font-semibold tracking-[0.2em]`}
          />

          {requireAuthenticatorCode && (
            <div className="mt-4">
              <label htmlFor="confirm-authenticator-code" className="mb-1.5 block text-[13px] font-semibold text-ink-soft">{tr("Google Authenticator code")}</label>
              <input
                id="confirm-authenticator-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={authenticatorCode}
                onChange={(event) => setAuthenticatorCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className={`${inputClass} text-center font-semibold tracking-[0.35em] tabular-nums`}
              />
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onCancel} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
            <button
              type="button"
              onClick={() => onConfirm(requireAuthenticatorCode ? authenticatorCode : undefined)}
              disabled={!ready}
              className={danger ? BTN.danger : BTN.primary}
            >
              {busy ? tr("Working…") : tr(confirmLabel)}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
