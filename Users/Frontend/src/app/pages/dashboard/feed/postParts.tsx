import type { ReactNode } from "react";
import { GOLD_GRADIENT, NAVY_GRADIENT } from "./feedStyle";

/** Pieces shared by the report post card and the auction post card, so both read as one feed. */

/** One button of the action bar (Helpful, Comment, Share...). Three of them share a row. */
export const ACTION =
  "group relative flex min-h-[46px] items-center justify-center gap-2 rounded-xl text-[14px] font-semibold transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.97]";

/** The resting and hover look of an action button that is not switched on. */
export const ACTION_IDLE = "text-ink-soft hover:bg-frost-100";

/** The number on an action button: a small badge on the corner of its icon, so the button never gets wider and the icon is never squeezed. */
export function CountBadge({ value, gold = false, label }: { value: number; gold?: boolean; label: string }) {
  return (
    <span
      className={`absolute -right-3.5 -top-2.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums ring-2 ring-white ${gold ? "bg-gold-500 text-navy-950" : "bg-navy-800 text-white"}`}
      aria-label={`${value} ${label}`}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}

/** The wide button under the action bar: gold for the main step (claim, bid), navy for the others. */
export function PrimaryAction({ label, hint, gold, onClick, title }: { label: string; hint?: string; gold: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? hint}
      className={`group my-2.5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 text-[14.5px] font-semibold transition-[transform,box-shadow,filter] duration-200 hover:-translate-y-px active:scale-[0.99] ${
        gold
          ? `${GOLD_GRADIENT} text-navy-950 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,0_10px_22px_-12px_rgba(209,161,83,0.9)] hover:brightness-105`
          : `${NAVY_GRADIENT} text-white shadow-[0_10px_22px_-12px_rgba(31,49,96,0.9)] hover:brightness-110`
      }`}
    >
      {label}{hint && <span className="text-[13px] font-medium opacity-75">· {hint}</span>}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
    </button>
  );
}

/** A small rounded fact under a post's text: place, date, category, price. */
export function Chip({ icon, children, mono = false }: { icon?: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <li className={`inline-flex items-center gap-1.5 rounded-full bg-frost-100/80 px-2.5 py-1 ${mono ? "font-mono text-[12px] text-ink-muted" : ""}`}>
      {icon}{children}
    </li>
  );
}
