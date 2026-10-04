/**
 * E-Balik Design Tokens — "Campus Utility"
 * Shared across all user-facing pages for visual consistency.
 * Import as: import { CX } from "@/app/utils/clay";
 *
 * Direction: Swiss-modern, utilitarian, fast to scan. Navy anchors structure,
 * gold marks the primary action and brand moments, tide (teal) signals matches/info.
 * Color scales live in src/styles/theme.css (@theme): navy-*, gold-*, tide-*, page, line, ink.
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500";
const btnBase = `inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold text-[14px] min-h-[44px] px-5 transition-[background-color,border-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const badgeBase = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-5 whitespace-nowrap";

export const CX = {
  // Page wrappers
  page:        "flex-1 min-h-screen bg-page px-4 py-6 sm:px-6 md:px-8 md:py-8",
  inner:       "mx-auto w-full max-w-[1200px]",

  // Page header pieces
  eyebrow:     "text-[12px] font-semibold uppercase tracking-[0.12em] text-gold-700",
  pageTitle:   "font-[family-name:var(--font-heading)] text-[26px] md:text-[30px] font-semibold leading-tight tracking-[-0.015em] text-ink",
  pageLead:    "mt-1.5 max-w-[62ch] text-[15px] leading-6 text-ink-muted",

  // Cards — light surface
  card:        "rounded-[var(--radius-card)] border border-line bg-white shadow-card",
  cardSm:      "rounded-xl border border-line bg-white shadow-card",
  cardHover:   "rounded-[var(--radius-card)] border border-line bg-white shadow-card transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-raised",

  // Cards — dark navy
  cardNavy:    "rounded-[var(--radius-card)] border border-navy-700 bg-navy-800 text-white shadow-raised",

  // Buttons
  btnNavy:     `${btnBase} border border-navy-800 bg-navy-800 text-white hover:bg-navy-700 hover:border-navy-700 active:bg-navy-900`,
  btnGold:     `${btnBase} border border-gold-500 bg-gold-500 text-navy-950 hover:bg-gold-400 hover:border-gold-400 active:bg-gold-600`,
  btnGhost:    `${btnBase} border border-line-strong bg-white text-navy-800 hover:bg-navy-50 hover:border-navy-200 active:bg-navy-100`,
  btnDanger:   `${btnBase} border border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:border-rose-700 active:bg-rose-800`,
  btnSubtle:   `${btnBase} border border-transparent bg-transparent text-navy-700 hover:bg-navy-50 active:bg-navy-100`,

  // Inputs
  input:       `rounded-[var(--radius-control)] border border-line-strong bg-white px-3.5 min-h-[44px] text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-slate-400 hover:border-navy-300 focus:border-navy-600 focus:shadow-[0_0_0_3px_rgba(51,73,127,0.15)] disabled:bg-slate-50 disabled:text-slate-500`,
  inputError:  "rounded-[var(--radius-control)] border border-rose-500 bg-white px-3.5 min-h-[44px] text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:shadow-[0_0_0_3px_rgba(225,29,72,0.15)] placeholder:text-rose-300",
  label:       "mb-1.5 block text-[14px] font-semibold text-ink-soft",
  helper:      "mt-1.5 text-[13px] leading-5 text-ink-muted",

  // Status badges
  badgeGold:   `${badgeBase} border border-gold-200 bg-gold-50 text-gold-800`,
  badgeNavy:   `${badgeBase} border border-navy-800 bg-navy-800 text-white`,
  badgeGreen:  `${badgeBase} border border-emerald-200 bg-emerald-50 text-emerald-800`,
  badgeRed:    `${badgeBase} border border-rose-200 bg-rose-50 text-rose-800`,
  badgeTide:   `${badgeBase} border border-tide-200 bg-tide-50 text-tide-700`,
  badgeAmber:  `${badgeBase} border border-amber-200 bg-amber-50 text-amber-800`,
  badgeNeutral:`${badgeBase} border border-line bg-slate-50 text-ink-soft`,

  // Section label (above h2)
  sectionLabel: "mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-gold-700",

  // Alert banners
  alertError:   "rounded-[var(--radius-control)] border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] leading-5 text-rose-800",
  alertSuccess: "rounded-[var(--radius-control)] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] leading-5 text-emerald-800",
  alertInfo:    "rounded-[var(--radius-control)] border border-tide-200 bg-tide-50 px-4 py-3 text-[14px] leading-5 text-tide-700",

  // Divider
  divider:     "h-px w-full bg-line",

  // Modal shell (matches Login/Register)
  modal:       "relative flex flex-col gap-5 items-start p-7 rounded-2xl border border-line bg-white shadow-overlay",
};

/** Spring animation config for motion/react */
export const SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;
