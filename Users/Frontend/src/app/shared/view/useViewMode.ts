import { useCallback, useSyncExternalStore } from "react";

/**
 * App-wide "tile" / "list" preference for item collections.
 * One setting shared by every page (Dashboard, Browse, My Reports, Matches, report history),
 * persisted per device and synced across mounted components and browser tabs.
 */
export type ViewMode = "tile" | "list";

const STORAGE_KEY = "ebalik_view_mode";
const CHANGE_EVENT = "ebalik-view-mode-change";

function read(): ViewMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "list" ? "list" : "tile";
  } catch {
    return "tile";
  }
}

let current: ViewMode = typeof window === "undefined" ? "tile" : read();

function subscribe(listener: () => void) {
  const sync = () => {
    current = read();
    listener();
  };
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) sync(); };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setViewMode(mode: ViewMode) {
  current = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage unavailable; the in-memory preference still applies for this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, () => current, () => "tile" as ViewMode);
  const update = useCallback((next: ViewMode) => setViewMode(next), []);
  return [mode, update];
}
