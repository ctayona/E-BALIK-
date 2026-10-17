/**
 * One look for every card on the home page: frosted white glass with a hairline edge and a soft navy shadow (the Gallery Glass theme).
 * In dark mode the theme turns `bg-white/85` into navy glass, so cards need no dark variants of their own.
 */
export const FEED_CARD = "rounded-[22px] border border-white/80 bg-white/85 shadow-card backdrop-blur-xl ring-1 ring-navy-900/[0.04]";

/** A card that reacts to the pointer (shortcuts, stories). */
export const FEED_CARD_LIFT = "transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-raised";

/** The gold of the brand, used for avatars and the active "Helpful" glow. */
export const GOLD_GRADIENT = "bg-gradient-to-b from-[#ecc787] to-[#d1a153]";

/** The navy of the brand, used for avatars and badges. */
export const NAVY_GRADIENT = "bg-[linear-gradient(160deg,#33497f_0%,#1f3160_60%,#162448_100%)]";
