import { useSyncExternalStore } from "react";

/**
 * Global information modal store.
 *
 * Any code (pages, hooks, API helpers) calls `showInfoModal()` after a process finishes.
 * Messages queue and are shown one at a time by <InfoModalHost /> mounted once in App.
 * The queue is mirrored to sessionStorage so a result survives a reload or redirect.
 */

export type InfoModalVariant = "success" | "error" | "warning" | "info";

export interface InfoModalInput {
  variant: InfoModalVariant;
  title: string;
  message: string;
  /** Extra bullet points (e.g. partial failures, next steps). */
  details?: string[];
  /** Report or claim reference shown as a copyable chip. */
  reference?: string;
  /** Label for the dismiss button. */
  actionLabel?: string;
  /** Override auto-close in ms; `null` keeps the modal open until dismissed. */
  autoCloseMs?: number | null;
  /** Marks a generic message emitted automatically by a shared layer (API helpers). */
  auto?: boolean;
  /** Replace the visible message if it was emitted automatically, instead of queueing behind it. */
  replaceAuto?: boolean;
}

export interface InfoModalEntry extends Omit<InfoModalInput, "replaceAuto"> {
  id: number;
  createdAt: number;
}

const STORAGE_KEY = "ebalik_info_modal_queue";
const MAX_RESTORE_AGE_MS = 60_000;
const DEFAULT_AUTO_CLOSE: Record<InfoModalVariant, number | null> = {
  success: 4500,
  info: 5500,
  warning: null,
  error: null,
};

let nextId = 1;
let queue: InfoModalEntry[] = restoreQueue();
const listeners = new Set<() => void>();

function restoreQueue(): InfoModalEntry[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InfoModalEntry[];
    const now = Date.now();
    const fresh = Array.isArray(parsed) ? parsed.filter((entry) => entry && now - entry.createdAt < MAX_RESTORE_AGE_MS) : [];
    nextId = fresh.reduce((max, entry) => Math.max(max, entry.id + 1), 1);
    return fresh;
  } catch {
    return [];
  }
}

function commit(next: InfoModalEntry[]) {
  queue = next;
  try {
    if (queue.length) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode); the in-memory queue still works.
  }
  listeners.forEach((listener) => listener());
}

export function resolveAutoClose(entry: InfoModalEntry): number | null {
  return entry.autoCloseMs === undefined ? DEFAULT_AUTO_CLOSE[entry.variant] : entry.autoCloseMs;
}

export function showInfoModal(input: InfoModalInput): number {
  const { replaceAuto, ...rest } = input;
  const duplicate = queue.find((entry) => entry.variant === rest.variant && entry.title === rest.title && entry.message === rest.message);
  if (duplicate) return duplicate.id;

  const entry: InfoModalEntry = { ...rest, id: nextId++, createdAt: Date.now() };
  if (replaceAuto && queue[0]?.auto) commit([entry, ...queue.slice(1)]);
  else commit([...queue, entry]);
  return entry.id;
}

export function dismissInfoModal(id: number) {
  if (!queue.some((entry) => entry.id === id)) return;
  commit(queue.filter((entry) => entry.id !== id));
}

/** Convenience helper for `{ success, error }` results returned by useAuth. */
export function showProcessResult(
  result: { success: boolean; error?: string },
  copy: { successTitle: string; successMessage: string; errorTitle: string; errorFallback: string; reference?: string; details?: string[] },
) {
  if (result.success) {
    return showInfoModal({ variant: "success", title: copy.successTitle, message: copy.successMessage, reference: copy.reference, details: copy.details });
  }
  return showInfoModal({ variant: "error", title: copy.errorTitle, message: result.error || copy.errorFallback });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return queue;
}

export function useInfoModalQueue() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
