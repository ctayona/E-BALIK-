import { useEffect, useState } from "react";

/** Ticks once a second so countdowns re-render without each component running its own timer. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Offset between the server clock and this device, so countdowns match the server even if the device clock is off. */
export function serverOffset(serverTime?: string) {
  const parsed = serverTime ? Date.parse(serverTime) : NaN;
  return Number.isFinite(parsed) ? parsed - Date.now() : 0;
}

/** 90061000 → "1d 1h", 3725000 → "1h 02m", 125000 → "2m 05s", 8000 → "8s". Returns "" once the time has passed. */
export function formatRemaining(ms: number) {
  if (ms <= 0) return "";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Value for <input type="datetime-local"> in the device's time zone. */
export function toLocalInput(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}
