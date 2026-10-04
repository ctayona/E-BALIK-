import { useState } from "react";

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
  const [authenticatorCode, setAuthenticatorCode] = useState("");

  const accentColor = danger ? "#dc2626" : "#0f8077";
  const accentBg = danger ? "#fef2f2" : "#ecfaf8";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-[3px] p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white overflow-hidden">
        {/* Top accent bar */}
        <div className="h-1 w-full" style={{ background: accentColor }} />

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start gap-3 mb-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: accentBg }}>
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" style={{ color: accentColor }}>
                <path d="M12 9v4m0 4h.01M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-bold uppercase tracking-[0.12em] mb-1" style={{ color: accentColor }}>Confirmation required</div>
              <h2 id="confirm-action-title" className="text-lg font-bold text-slate-900 leading-tight">Are you sure? {title}</h2>
            </div>
          </div>

          <p className="text-sm leading-6 text-slate-600 mb-4">{description} Double-check this action before continuing.</p>

          {/* Confirm input */}
          <div>
            <label htmlFor="confirm-action-input" className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.1em] text-slate-500">Type CONFIRM to continue</label>
            <input
              id="confirm-action-input"
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="CONFIRM"
              className="w-full rounded-xl border border-line bg-slate-50 px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-600/20 focus:bg-white transition-all"
            />
          </div>

          {requireAuthenticatorCode && <div className="mt-4">
            <label htmlFor="confirm-authenticator-code" className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.1em] text-slate-500">Google Authenticator code</label>
            <input
              id="confirm-authenticator-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={authenticatorCode}
              onChange={(event) => setAuthenticatorCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="w-full rounded-xl border border-line bg-slate-50 px-4 py-2.5 text-sm tracking-[0.25em] text-slate-700 outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-600/20 focus:bg-white transition-all"
            />
          </div>}

          {/* Actions */}
          <div className="mt-5 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-navy-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(requireAuthenticatorCode ? authenticatorCode : undefined)}
              disabled={typed !== "CONFIRM" || (requireAuthenticatorCode && authenticatorCode.length !== 6) || busy}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 transition-all hover:shadow-md"
              style={{ background: accentColor }}
            >
              {busy ? "Working..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
