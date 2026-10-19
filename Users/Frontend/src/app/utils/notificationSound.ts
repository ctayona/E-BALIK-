import { useSyncExternalStore } from "react";

/**
 * Optional sound when a new notification arrives. Off by default and kept per device (a sound is a property of the device, like the
 * theme). The chime is synthesised with the Web Audio API, so there is no audio file to download or cache.
 */
const KEY = "ebalik_notification_sound";
const EVENT = "ebalik-notification-sound";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

let enabled = read();
let context: AudioContext | null = null;

export function setNotificationSound(on: boolean) {
  enabled = on;
  try {
    if (on) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useNotificationSound(): [boolean, (on: boolean) => void] {
  const current = useSyncExternalStore(
    (callback) => { window.addEventListener(EVENT, callback); return () => window.removeEventListener(EVENT, callback); },
    () => enabled,
  );
  return [current, setNotificationSound];
}

/** A short two-note chime. Browsers only allow sound after the person has interacted with the page; until then this does nothing. */
export function playNotificationChime(force = false) {
  if (!enabled && !force) return;
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    context = context ?? new AudioCtor();
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime + 0.01;
    [880, 1318.5].forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const at = start + index * 0.13;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.34);
    });
  } catch {
    // No audio on this device: the badge still shows the new notification.
  }
}
