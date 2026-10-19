import { useSyncExternalStore } from "react";

/**
 * Per-device page settings (text size, reduced motion, the feed shown first). Like the theme and the notification sound they are a
 * property of the device, so they live in localStorage and apply at once, before the first paint, with no account round trip.
 */
export type TextSize = "small" | "default" | "large" | "xlarge";
export type FeedTab = "all" | "found" | "missing" | "auctions";

export interface Preferences {
  textSize: TextSize;
  reduceMotion: boolean;
  /** The Home feed tab that opens first. */
  homeFeed: FeedTab;
  /** Keep the Home page to the feed (hides the side columns' extras on wide screens). */
  focusFeed: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { textSize: "default", reduceMotion: false, homeFeed: "all", focusFeed: false };

export const TEXT_SIZE_PERCENT: Record<TextSize, number> = { small: 93.75, default: 100, large: 112.5, xlarge: 125 };

const KEY = "ebalik_user_preferences";
const EVENT = "ebalik-user-preferences";

function sanitize(raw: unknown): Preferences {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<Preferences>;
  return {
    textSize: source.textSize && source.textSize in TEXT_SIZE_PERCENT ? source.textSize : DEFAULT_PREFERENCES.textSize,
    reduceMotion: source.reduceMotion === true,
    homeFeed: ["all", "found", "missing", "auctions"].includes(String(source.homeFeed)) ? (source.homeFeed as FeedTab) : DEFAULT_PREFERENCES.homeFeed,
    focusFeed: source.focusFeed === true,
  };
}

function read(): Preferences {
  try {
    const stored = localStorage.getItem(KEY);
    return sanitize(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

let current: Preferences = read();

function apply() {
  const root = document.documentElement;
  root.style.fontSize = current.textSize === "default" ? "" : `${TEXT_SIZE_PERCENT[current.textSize]}%`;
  if (current.reduceMotion) root.dataset.motion = "reduce";
  else delete root.dataset.motion;
}

/** Call before the first render, next to `initTheme`, so the page never flashes at the wrong size. */
export function initPreferences() {
  current = read();
  apply();
}

export function getPreferences(): Preferences {
  return current;
}

export function updatePreferences(patch: Partial<Preferences>) {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
  apply();
  window.dispatchEvent(new Event(EVENT));
}

export function resetPreferences() {
  current = { ...DEFAULT_PREFERENCES };
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to clear.
  }
  apply();
  window.dispatchEvent(new Event(EVENT));
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (callback) => { window.addEventListener(EVENT, callback); return () => window.removeEventListener(EVENT, callback); },
    () => current,
  );
}
