import { useSyncExternalStore } from "react";

/**
 * Small, passing messages ("Link copied") that need no click. Anything calls `showToast()`; <ToastHost /> in App shows them for a few
 * seconds. Use the information modal instead for the result of a process the person has to read.
 */
export type ToastTone = "success" | "error" | "info";
export interface Toast { id: number; message: string; tone: ToastTone }

const MAX_VISIBLE = 3;
const DURATION_MS = 2800;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function showToast(message: string, tone: ToastTone = "success") {
  const id = nextId++;
  toasts = [...toasts.filter((toast) => toast.message !== message), { id, message, tone }].slice(-MAX_VISIBLE);
  emit();
  window.setTimeout(() => dismissToast(id), DURATION_MS);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => toasts,
    () => toasts,
  );
}
