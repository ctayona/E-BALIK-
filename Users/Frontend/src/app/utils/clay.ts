/**
 * E-Balik Design Tokens — "Gallery Glass"
 * Shared across all user-facing pages for visual consistency.
 * Import as: import { CX } from "@/app/utils/clay";
 *
 * Direction: premium, image-led and fast to scan. Navy anchors structure, gold marks the
 * primary action, iris (periwinkle) handles links/focus, tide (mint) signals matches and good news.
 * Glass surfaces (.glass / .glass-dark) are reserved for overlays, sticky bars and photo captions.
 * Color scales live in src/styles/theme.css (@theme): navy-*, gold-*, iris-*, tide-*, frost-*, page, line, ink.
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iris-500";
const btnBase = `inline-flex items-center justify-center gap-2 rounded-xl font-semibold text-[14px] min-h-[44px] px-5 transition-[background-color,background-position,border-color,color,box-shadow,transform] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${focusRing}`;
const badgeBase = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-5 whitespace-nowrap";

export const CX = {
  // Page wrappers
  page:        "flex-1 min-h-screen px-4 py-6 sm:px-6 md:px-8 md:py-8",
  inner:       "mx-auto w-full max-w-[1200px]",

  // Page header pieces
  eyebrow:     "text-[13px] font-semibold text-gold-700",
  pageTitle:   "font-[family-name:var(--font-heading)] text-[28px] md:text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink",
  pageLead:    "mt-1.5 max-w-[62ch] text-[15px] leading-6 text-ink-muted",

  // Cards — light surface
  card:        "rounded-[20px] border border-white/80 bg-white/90 shadow-card",
  cardSm:      "rounded-2xl border border-white/80 bg-white/90 shadow-card",
  cardHover:   "rounded-[20px] border border-white/80 bg-white/90 shadow-card transition-[box-shadow,transform] duration-300 ease-out hover:-translate-y-1 hover:shadow-raised",

  // Cards — dark navy
  cardNavy:    "rounded-[20px] border border-white/10 bg-[linear-gradient(135deg,#22366a_0%,#162448_60%,#0e1830_100%)] text-white shadow-raised",

  // Buttons
  btnNavy:     `${btnBase} border border-navy-900 bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_8px_20px_-10px_rgba(17,27,66,0.7)] hover:shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_14px_28px_-12px_rgba(17,27,66,0.8)]`,
  btnGold:     `${btnBase} border border-gold-600/40 bg-[linear-gradient(180deg,#e6be76_0%,#d1a153_100%)] text-navy-950 shadow-[0_1px_0_rgba(255,255,255,0.45)_inset] hover:shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,var(--shadow-glow-gold)]`,
  btnGhost:    `${btnBase} border border-line-strong bg-white/80 text-navy-800 hover:bg-white hover:border-iris-300 hover:text-navy-900`,
  btnDanger:   `${btnBase} border border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:border-rose-700 active:bg-rose-800`,
  btnSubtle:   `${btnBase} border border-transparent bg-transparent text-navy-700 hover:bg-navy-50 active:bg-navy-100`,

  // Inputs
  input:       `rounded-xl border border-line-strong bg-white/90 px-3.5 min-h-[44px] text-[16px] sm:text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-slate-400 hover:border-iris-300 focus:border-iris-500 focus:shadow-[0_0_0_4px_rgba(110,142,240,0.18)] disabled:bg-slate-50 disabled:text-slate-500`,
  inputError:  "rounded-[var(--radius-control)] border border-rose-500 bg-white px-3.5 min-h-[44px] text-[16px] sm:text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:shadow-[0_0_0_3px_rgba(225,29,72,0.15)] placeholder:text-rose-300",
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
  sectionLabel: "mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold-700",

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
