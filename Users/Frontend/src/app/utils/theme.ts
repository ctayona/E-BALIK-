import { useSyncExternalStore } from "react";

/** Per-device colour theme for the E-Balik user app (mirrors the admin console's theme store). */

export type Theme = "light" | "dark";

const THEME_KEY = "ebalik_user_theme";
const EVENT = "ebalik-user-theme";

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

let theme: Theme = readStored() ?? (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function apply() {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // Keep the browser/PWA chrome in step with the page.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#070c19" : "#162448");
}

/** Call before the first render so the page never flashes the wrong theme. */
export function initTheme() {
  apply();
}

export function setTheme(next: Theme) {
  theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage can be blocked; the choice still applies for this visit.
  }
  apply();
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

export function useTheme(): [Theme, () => void] {
  const current = useSyncExternalStore(subscribe, () => theme);
  return [current, () => setTheme(current === "dark" ? "light" : "dark")];
}
