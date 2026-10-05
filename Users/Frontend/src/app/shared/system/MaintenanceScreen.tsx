import { useState } from "react";
import { LockKeyhole, RefreshCw, Wrench } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import umakLogo from "@/imports/umaklogo.webp";
import Login from "@/app/pages/home/Login";
import { CX } from "@/app/utils/clay";
import type { SystemStatus } from "@/app/utils/system";

const DEFAULT_MESSAGE = "We are making improvements to E-Balik. Please check back in a little while.";

/** Full-screen lock shown to standard users while an administrator has maintenance mode on. Staff can still sign in. */
export default function MaintenanceScreen({ status, onRefresh, onStaffSignedIn }: { status: SystemStatus; onRefresh: () => Promise<void>; onStaffSignedIn: () => void }) {
  const reduced = useReducedMotion();
  const [checking, setChecking] = useState(false);
  const [staffLogin, setStaffLogin] = useState(false);

  async function check() {
    setChecking(true);
    try { await onRefresh(); } finally { setChecking(false); }
  }

  return (
    <main className="app-canvas relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(31,49,96,0.2),transparent)]" aria-hidden="true" />
      <motion.section
        initial={reduced ? false : { opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        aria-labelledby="maintenance-title"
        className="glass relative w-full max-w-[520px] overflow-hidden rounded-[28px] p-8 text-center sm:p-10"
      >
        <span className="pointer-events-none absolute inset-x-12 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.9),transparent)]" aria-hidden="true" />
        <img decoding="async" src={umakLogo} alt="University of Makati" className="mx-auto size-14 rounded-2xl object-cover ring-1 ring-line" />
        <span className="mx-auto mt-6 flex size-[72px] items-center justify-center rounded-[22px] bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300 shadow-[0_16px_32px_-14px_rgba(17,27,66,0.9)]" aria-hidden="true"><Wrench size={32} /></span>
        <h1 id="maintenance-title" className="mt-6 font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">System under maintenance</h1>
        <p className="mx-auto mt-3 max-w-[40ch] text-[15.5px] leading-7 text-ink-muted">{status.message || DEFAULT_MESSAGE}</p>
        {status.since && <p className="mt-3 text-[13px] text-ink-muted">Since {new Date(status.since).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>}
        <p className="mt-4 text-[13.5px] text-ink-muted">Your reports, claims and bids are safe. Nothing is lost.</p>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button type="button" onClick={() => void check()} disabled={checking} className={CX.btnGold}>
            <RefreshCw size={16} className={checking ? "animate-spin" : ""} aria-hidden="true" />{checking ? "Checking…" : "Check again"}
          </button>
          <button type="button" onClick={() => setStaffLogin(true)} className={CX.btnSubtle}><LockKeyhole size={15} aria-hidden="true" />Staff sign in</button>
        </div>
      </motion.section>

      {staffLogin && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-center sm:px-4" role="presentation">
          <div className="fixed inset-0 bg-navy-950/60 backdrop-blur-md" onClick={() => setStaffLogin(false)} />
          <div className="relative z-10 flex w-full items-end justify-center sm:w-auto sm:items-center sm:py-8">
            <Login staffOnly onClose={() => setStaffLogin(false)} onLoginSuccess={onStaffSignedIn} />
          </div>
        </div>
      )}
    </main>
  );
}
