import { useCallback, useSyncExternalStore } from "react";
import { STRINGS, type Language, type StringKey } from "../i18n/strings";
import { PHRASES_TL } from "../i18n/phrases";

/** Per-device admin console preferences: colour theme and interface language. */

export type Theme = "light" | "dark";

const THEME_KEY = "ebalik_admin_theme";
const LANGUAGE_KEY = "ebalik_admin_language";
const EVENT = "ebalik-admin-preferences";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked (private mode); the in-memory value still applies for this session.
  }
}

let theme: Theme = (() => {
  const stored = read(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
})();

let language: Language = read(LANGUAGE_KEY) === "tl" ? "tl" : "en";

function applyToDocument() {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.lang = language === "tl" ? "tl" : "en";
}

/** Call once before the first render so the page never flashes the wrong theme. */
export function initPreferences() {
  applyToDocument();
}

function emit() {
  applyToDocument();
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

export function setTheme(next: Theme) {
  theme = next;
  write(THEME_KEY, next);
  emit();
}

export function setLanguage(next: Language) {
  language = next;
  write(LANGUAGE_KEY, next);
  emit();
}

export function useTheme(): [Theme, (next: Theme) => void] {
  return [useSyncExternalStore(subscribe, () => theme), setTheme];
}

export function useLanguage(): [Language, (next: Language) => void] {
  return [useSyncExternalStore(subscribe, () => language), setLanguage];
}

type Vars = Record<string, string | number | null | undefined>;
export type Translate = (key: StringKey | (string & {}), vars?: Vars) => string;

function interpolate(text: string, vars?: Vars) {
  if (!vars) return text;
  for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value ?? ""));
  return text;
}

function translate(lang: Language, key: string, vars?: Vars) {
  const keyed = STRINGS[lang][key as StringKey] ?? STRINGS.en[key as StringKey];
  // Anything that isn't a dictionary key is an English phrase; Tagalog falls back to it when untranslated.
  const text = keyed ?? (lang === "tl" ? PHRASES_TL[key] ?? key : key);
  return interpolate(text, vars);
}

/**
 * Translate a key or English phrase with the current language. Plain function so it works in any
 * component; App subscribes to the language, so the whole tree re-renders when it changes.
 */
export function tr(phrase: string, vars?: Vars) {
  return translate(language, phrase, vars);
}

/** Hook form of `tr` that also subscribes the calling component to language changes. */
export function useT(): Translate {
  const [lang] = useLanguage();
  return useCallback<Translate>((key, vars) => translate(lang, key, vars), [lang]);
}

/** Translate a value only when it's a plain string (shared components receive strings or JSX). */
export function trText<T>(value: T): T | string {
  return typeof value === "string" ? tr(value) : value;
}
